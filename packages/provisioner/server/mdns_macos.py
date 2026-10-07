"""Publish through macOS mDNSResponder, scoped to the provisioning IPv4 interface.

The ABI and constants come from the macOS SDK's dns_sd.h. Both the address record
and service share one daemon connection; closing it withdraws both records.
"""
from __future__ import annotations

import ctypes as c
import ipaddress
import select
import socket
import sys
import threading
import time


def interface_for(host: str) -> int:
    import ifaddr
    matches = {socket.if_nametoindex(adapter.name) for adapter in ifaddr.get_adapters()
               if any(ip.ip == host for ip in adapter.ips)}
    if len(matches) != 1:
        raise ValueError(f'Cannot identify one local interface for {host}')
    return matches.pop()


class _Connection:
    """Small ctypes binding to the system DNS-SD client library; no raw UDP socket."""
    def __init__(self, host, port, name, interface, completed):
        # DNS-SD is exported by libSystem on macOS (as used by /usr/bin/dns-sd).
        self.lib = c.CDLL('/usr/lib/libSystem.B.dylib')
        self.ref, self.service, self.record = c.c_void_p(), c.c_void_p(), c.c_void_p()
        record_callback = c.CFUNCTYPE(None, c.c_void_p, c.c_void_p, c.c_uint32, c.c_int32, c.c_void_p)
        service_callback = c.CFUNCTYPE(None, c.c_void_p, c.c_uint32, c.c_int32,
                                      c.c_char_p, c.c_char_p, c.c_char_p, c.c_void_p)
        # Keep callback objects alive for the full lifetime of the daemon connection.
        self.record_callback = record_callback(lambda ref, record, flags, error, ctx: completed('address', error))
        self.service_callback = service_callback(
            lambda ref, flags, error, actual, kind, domain, ctx:
                completed('service', error or (0 if actual == name.encode() else -65548)))
        self._bind('DNSServiceCreateConnection', [c.POINTER(c.c_void_p)])
        self._bind('DNSServiceRegisterRecord', [c.c_void_p, c.POINTER(c.c_void_p), c.c_uint32,
            c.c_uint32, c.c_char_p, c.c_uint16, c.c_uint16, c.c_uint16, c.c_void_p,
            c.c_uint32, record_callback, c.c_void_p])
        self._bind('DNSServiceRegister', [c.POINTER(c.c_void_p), c.c_uint32, c.c_uint32,
            c.c_char_p, c.c_char_p, c.c_char_p, c.c_char_p, c.c_uint16, c.c_uint16,
            c.c_void_p, service_callback, c.c_void_p])
        self._bind('DNSServiceRefSockFD', [c.c_void_p])
        self._bind('DNSServiceProcessResult', [c.c_void_p])
        self._bind('DNSServiceRefDeallocate', [c.c_void_p], None)
        try:
            self._check(self.lib.DNSServiceCreateConnection(c.byref(self.ref)))
            hostname = (name + '.local.').encode()
            address = socket.inet_aton(host)
            # Unique A/IN record, with the daemon's default TTL.
            self._check(self.lib.DNSServiceRegisterRecord(self.ref, c.byref(self.record), 0x20,
                interface, hostname, 1, 1, len(address), address, 0, self.record_callback, None))
            self.service = c.c_void_p(self.ref.value)
            # ShareConnection | NoAutoRename; the TLS-derived identity must stay exact.
            self._check(self.lib.DNSServiceRegister(c.byref(self.service), 0x4000 | 0x8, interface,
                name.encode(), b'_hiraia-prov._tcp', b'local.', hostname,
                socket.htons(port), 4, b'\x03v=1', self.service_callback, None))
            self.fd = self.lib.DNSServiceRefSockFD(self.ref)
            if self.fd < 0:
                raise OSError('DNS-SD daemon returned no usable descriptor')
        except BaseException:
            self.close()
            raise

    def _bind(self, name, arguments, result=c.c_int32):
        function = getattr(self.lib, name)
        function.argtypes, function.restype = arguments, result

    @staticmethod
    def _check(code):
        if code:
            raise OSError(f'macOS DNS-SD error {code}')

    def process(self, timeout):
        if select.select([self.fd], [], [], timeout)[0]:
            self._check(self.lib.DNSServiceProcessResult(self.ref))

    def close(self):
        # Deallocating the parent also deallocates shared child registrations.
        if self.ref.value:
            self.lib.DNSServiceRefDeallocate(self.ref)
            self.ref = c.c_void_p()


class Advertisement:
    def __init__(self, host, port, name, *, on_failure=None, timeout=10,
                 connection_factory=_Connection, interface_lookup=interface_for):
        address = ipaddress.IPv4Address(host)
        if address.is_unspecified or address.is_multicast or address.is_loopback:
            raise ValueError('Discovery needs the provisioning LAN IPv4 address')
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('Invalid discovery port')
        if not name.startswith('hiraia-provisioning-') or len(name.encode()) > 63:
            raise ValueError('Invalid discovery identity')
        self.ready, self.error = set(), None
        self.stopped = threading.Event()
        self.connection, self.thread = None, None
        self.on_failure = on_failure
        try:
            self.connection = connection_factory(host, port, name, interface_lookup(host), self._completed)
            deadline = time.monotonic() + timeout
            while self.ready != {'address', 'service'}:
                if self.error:
                    raise self.error
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('macOS did not acknowledge both discovery records')
                self.connection.process(min(0.25, remaining))
            if self.error:
                raise self.error
            self.thread = threading.Thread(target=self._run, name='provisioning-dns-sd', daemon=True)
            self.thread.start()
        except BaseException:
            self.close()
            raise

    def _completed(self, kind, error):
        if error:
            self.error = OSError(f'macOS rejected {kind} discovery record: {error}')
        else:
            self.ready.add(kind)

    def _run(self):
        try:
            while not self.stopped.is_set():
                self.connection.process(0.25)
                if self.error:
                    raise self.error
        except Exception as error:
            self.error = error
            if not self.stopped.is_set():
                print(f'ERROR: provisioning discovery stopped: {error}', file=sys.stderr, flush=True)
                if self.on_failure:
                    self.on_failure(error)

    def close(self):
        self.stopped.set()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join()
        if self.connection:
            self.connection.close()
            self.connection = None
