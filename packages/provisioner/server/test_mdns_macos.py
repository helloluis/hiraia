"""Discovery must acknowledge both records, withdraw cleanly, and fail visibly."""
import contextlib
import io
import threading
import sys
import unittest
from unittest.mock import patch

import mdns_macos as mdns
import server


class FakeConnection:
    def __init__(self, completed, events):
        self.completed, self.events = completed, list(events)
        self.closed = 0
        self.fail = threading.Event()

    def process(self, timeout):
        if self.events:
            event = self.events.pop(0)
            if isinstance(event, Exception):
                raise event
            self.completed(*event)
        elif self.fail.wait(min(timeout, 0.01)):
            raise OSError('daemon disconnected')

    def close(self):
        self.closed += 1


class MacDiscovery(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin', 'requires the macOS system library')
    def test_native_system_library_exports_required_abi(self):
        library = mdns.c.CDLL('/usr/lib/libSystem.B.dylib')
        for symbol in ['DNSServiceCreateConnection', 'DNSServiceRegisterRecord', 'DNSServiceRegister',
                       'DNSServiceRefSockFD', 'DNSServiceProcessResult', 'DNSServiceRefDeallocate']:
            self.assertTrue(callable(getattr(library, symbol)))

    def make(self, events=(('address', 0), ('service', 0)), **kwargs):
        def factory(host, port, name, interface, completed):
            self.arguments = host, port, name, interface
            self.connection = FakeConnection(completed, events)
            return self.connection
        return mdns.Advertisement('192.168.68.66', 8443, 'hiraia-provisioning-test',
                                  connection_factory=factory, interface_lookup=lambda host: 14,
                                  timeout=0.03, **kwargs)

    def test_both_records_confirmed_and_close_idempotent(self):
        ad = self.make()
        self.assertEqual(ad.ready, {'address', 'service'})
        self.assertEqual(self.arguments, ('192.168.68.66', 8443, 'hiraia-provisioning-test', 14))
        ad.close(); ad.close()
        self.assertEqual(self.connection.closed, 1)
        self.assertFalse(ad.thread.is_alive())

    def test_either_record_can_arrive_first(self):
        ad = self.make((('service', 0), ('address', 0)))
        ad.close()
        self.assertEqual(self.connection.closed, 1)

    def test_missing_record_times_out_and_withdraws(self):
        for events in [[], [('service', 0)], [('address', 0)]]:
            with self.subTest(events=events), self.assertRaises(TimeoutError):
                self.make(events)
            self.assertEqual(self.connection.closed, 1)

    def test_async_registration_rejection_withdraws(self):
        for kind in ['address', 'service']:
            with self.subTest(kind=kind), self.assertRaisesRegex(OSError, 'rejected'):
                self.make(((kind, -65548),))
            self.assertEqual(self.connection.closed, 1)

    def test_initial_daemon_error_withdraws(self):
        with self.assertRaisesRegex(OSError, 'lost daemon'):
            self.make([OSError('lost daemon')])
        self.assertEqual(self.connection.closed, 1)

    def test_background_daemon_disconnect_calls_supervisor(self):
        failed = threading.Event()
        with contextlib.redirect_stderr(io.StringIO()):
            ad = self.make(on_failure=lambda error: failed.set())
            try:
                self.connection.fail.set()
                self.assertTrue(failed.wait(1))
                self.assertIsInstance(ad.error, OSError)
            finally:
                ad.close()
        self.assertEqual(self.connection.closed, 1)

    def test_normal_close_does_not_trigger_failure(self):
        failed = threading.Event()
        ad = self.make(on_failure=lambda error: failed.set())
        ad.close()
        self.assertFalse(failed.is_set())

    def test_invalid_address_port_and_identity_rejected_before_binding(self):
        factory = lambda *args: self.fail('must not create a daemon connection')
        for host, port, name in [('0.0.0.0', 8443, 'hiraia-provisioning-test'),
                                ('127.0.0.1', 8443, 'hiraia-provisioning-test'),
                                ('224.0.0.251', 8443, 'hiraia-provisioning-test'),
                                ('192.168.68.66', True, 'hiraia-provisioning-test'),
                                ('192.168.68.66', 0, 'hiraia-provisioning-test'),
                                ('192.168.68.66', 8443, 'wrong-identity')]:
            with self.subTest(host=host, port=port, name=name), self.assertRaises(ValueError):
                mdns.Advertisement(host, port, name, connection_factory=factory)

    def test_mac_server_uses_native_backend_and_restarts_on_daemon_failure(self):
        with patch.object(server.sys, 'platform', 'darwin'), \
                patch.object(mdns, 'Advertisement') as constructor, patch.object(server.os, 'kill') as kill:
            result = server.advertise('192.168.68.66', 8443, 'existing-key-pin')
            self.assertIs(result, constructor.return_value)
            self.assertEqual(constructor.call_args.args[:2], ('192.168.68.66', 8443))
            self.assertTrue(constructor.call_args.args[2].startswith('hiraia-provisioning-'))
            constructor.call_args.kwargs['on_failure'](OSError('daemon stopped'))
            kill.assert_called_once_with(server.os.getpid(), server.signal.SIGTERM)


if __name__ == '__main__':
    unittest.main()
