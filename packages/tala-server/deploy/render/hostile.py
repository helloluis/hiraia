#!/usr/bin/env python3
"""Plays a LibreOffice that has been taken over, INSIDE the drawing job's box, to test the box (sandbox-run.mjs).

It tries what an attacker would try and reports, one JSON object per line, whether the box let it. It is written
to be harmless where something IS allowed: reads only, signal 0 only, files only where it is told it may write,
and no system call that would change the host if it went through (no clock, host name, reboot, kill).

    hostile.py survey [--canary PATH]... [--tcp HOST:PORT]... [--unix PATH]... [--pid PID]...
    hostile.py memory        take memory until something stops it
    hostile.py processes     start processes until something stops it
    hostile.py storm         a real fork bomb, for 5 seconds
    hostile.py disk          fill every place that can be written
    hostile.py bigfile       one file as large as it will go
    hostile.py cpu           burn processor time for ever
    hostile.py sleep         do nothing for ever
    hostile.py files         open files until it is refused
    hostile.py orphans       leave processes behind that try to outlive the job, and files in every writable place
    hostile.py crash         die of a memory fault, as a broken LibreOffice would

Python's standard library only.
"""
import ctypes
import errno
import json
import os
import signal
import socket
import subprocess
import sys
import time

libc = ctypes.CDLL(None, use_errno=True)
SCRATCH = os.environ.get('TALA_RENDER_SCRATCH', '/tmp')


def say(**fields):
    sys.stdout.write(json.dumps(fields) + '\n')
    sys.stdout.flush()


def err_name(e):
    return errno.errorcode.get(getattr(e, 'errno', None) or 0, type(e).__name__)


def attempt(kind, what, fn):
    """fn returns a detail string when the thing WORKED; raising means the box stopped it."""
    try:
        detail = fn()
        say(kind=kind, what=what, allowed=True, detail=str(detail)[:160])
    except BaseException as e:  # noqa: BLE001 - every failure is a "blocked"
        say(kind=kind, what=what, allowed=False, detail=err_name(e))


def c_call(name, *args):
    ctypes.set_errno(0)
    r = getattr(libc, name)(*args)
    if r != 0:
        e = ctypes.get_errno()
        raise OSError(e or errno.EPERM, os.strerror(e or errno.EPERM))
    return 'returned 0'


def read_path(p):
    if os.path.isdir(p) and not os.path.islink(p):
        names = os.listdir(p)
        if not names:
            raise FileNotFoundError(errno.ENOENT, 'empty')
        return f'{len(names)} entries, e.g. {sorted(names)[0]}'
    with open(p, 'rb') as f:
        data = f.read(64)
    if not data:
        raise OSError(errno.ENODATA, 'empty')
    return f'{len(data)} bytes read'


def write_dir(d):
    p = os.path.join(d, f'.hostile-{os.getpid()}')
    with open(p, 'wb') as f:
        f.write(b'x')
    os.unlink(p)
    return 'created and removed a file'


def write_file(p, text):
    with open(p, 'w') as f:
        f.write(text)
    return 'written'


def tcp(host, port, family=socket.AF_INET):
    s = socket.socket(family, socket.SOCK_STREAM)
    s.settimeout(1.5)
    try:
        s.connect((host, port))
        s.sendall(b'GET /hostile HTTP/1.0\r\n\r\n')
        return 'connected'
    finally:
        s.close()


def udp(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.sendto(b'x', (host, port))
        return 'sent'
    finally:
        s.close()


def unix(path):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(1.5)
    try:
        s.connect(path)
        return 'connected'
    finally:
        s.close()


def own_cgroup():
    with open('/proc/self/cgroup') as f:
        return '/sys/fs/cgroup' + f.read().strip().split('::', 1)[1]


def other_groups():
    """Control groups and their files that are not on the way to this program's own group."""
    own = own_cgroup()
    found = []
    for root, dirs, files in os.walk('/sys/fs/cgroup'):
        inside = root == own or root.startswith(own + '/')
        for d in dirs:
            p = os.path.join(root, d)
            if not (inside or own == p or own.startswith(p + '/')):
                found.append(p)
        if not inside:
            found.extend(os.path.join(root, f) for f in files)
        if len(found) > 200:
            break
    if not found:
        raise FileNotFoundError(errno.ENOENT, 'none in sight')
    return f'{len(found)} in sight, e.g. {sorted(found)[0]}'


def usr_local():
    """Anything under /usr/local that is not the job's own program folder."""
    found = []
    for root, dirs, files in os.walk('/usr/local'):
        for name in dirs + files:
            p = os.path.join(root, name)
            if p == '/usr/local/lib' or p == '/usr/local/lib/tala-render' or p.startswith('/usr/local/lib/tala-render/'):
                continue
            found.append(p)
        if len(found) > 200:
            break
    if not found:
        raise FileNotFoundError(errno.ENOENT, 'nothing but its own program')
    return f'{len(found)} in sight, e.g. {sorted(found)[0]}'


def io_uring(number, *args):
    """A system call of the io_uring family. EPERM means the box refused the call itself."""
    libc.syscall.restype = ctypes.c_long
    ctypes.set_errno(0)
    r = libc.syscall(number, *args)
    e = ctypes.get_errno()
    if r >= 0:
        if number == 425:
            os.close(r)
        return 'the call went through'
    if e in (errno.EPERM, errno.ENOSYS):
        raise OSError(e, os.strerror(e))
    return f'the call reached the kernel ({errno.errorcode.get(e, e)})'


def survey(argv):
    opts = {'--canary': [], '--tcp': [], '--unix': [], '--pid': []}
    i = 0
    while i < len(argv):
        opts[argv[i]].append(argv[i + 1])
        i += 2

    say(kind='self', uid=os.getuid(), gid=os.getgid(), groups=os.getgroups(), cwd=os.getcwd(), pid=os.getpid(),
        root=sorted(os.listdir('/')), etc=sorted(os.listdir('/etc')) if os.path.isdir('/etc') else None,
        scratch=sorted(os.listdir(SCRATCH)), environment=sorted(os.environ.keys()))

    # 1. Read what must not be readable.
    for p in ['/etc/passwd', '/etc/shadow', '/etc/tala/tala.env', '/etc/tala', '/var/lib/tala/tala.db', '/var/lib/tala', '/opt/tala', '/home', '/root',
              '/etc/ssh', '/etc/ssl/private', '/etc/machine-id', '/etc/hostname', '/var/log', '/var/lib', '/srv', '/mnt', '/boot', '/run/user',
              '/proc/1/environ', '/proc/1/root', '/proc/kcore', '/dev/kmsg', '/dev/mem', '/dev/sda', '/dev/nvme0n1', '/dev/vda', '/sys/kernel/debug'] + opts['--canary']:
        attempt('read', p, lambda p=p: read_path(p))
    # What the kernel tells about itself and the machine (no file of anybody's): reported, and judged by the tester.
    for p in ['/proc/1/cmdline', '/proc/sys/kernel/hostname', '/proc/kallsyms', '/proc/meminfo', '/sys/firmware', '/sys/class/net']:
        attempt('kernel-info', p, lambda p=p: read_path(p))
    for pid in opts['--pid']:
        for leaf in ['environ', 'root', 'cwd', 'mem', 'maps']:
            attempt('read-other-process', f'/proc/{pid}/{leaf}', lambda p=f'/proc/{pid}/{leaf}': read_path(p))
    visible = [n for n in os.listdir('/proc') if n.isdigit()]
    say(kind='processes-in-sight', count=len(visible))
    # The host's other services by name, and the administrator's own programs: neither is the job's to see.
    attempt('other-groups', 'control groups other than its own', other_groups)
    attempt('other-groups', '/sys/fs/cgroup/system.slice', lambda: read_path('/sys/fs/cgroup/system.slice'))
    attempt('other-groups', '/sys/fs/cgroup/cgroup.procs (the root group)', lambda: read_path('/sys/fs/cgroup/cgroup.procs'))
    attempt('usr-local', 'anything in /usr/local but its own program', usr_local)

    # 2. Write where nothing may be written. (The scratch space is the one place that must work.)
    for d in ['/', '/usr', '/usr/bin', '/usr/local/lib', '/etc', '/etc/fonts', '/var', '/var/tmp', '/dev', '/dev/shm', '/run', '/home', '/opt', '/proc', '/sys']:
        attempt('write', d, lambda d=d: write_dir(d))
    attempt('write-scratch', SCRATCH, lambda: write_dir(SCRATCH))
    cg = own_cgroup()
    attempt('raise-own-ceiling', 'memory.max', lambda: write_file(cg + '/memory.max', 'max'))
    attempt('raise-own-ceiling', 'pids.max', lambda: write_file(cg + '/pids.max', 'max'))
    attempt('leave-own-group', 'cgroup.procs of the root group', lambda: write_file('/sys/fs/cgroup/cgroup.procs', str(os.getpid())))
    attempt('write', '/proc/sys/kernel/core_pattern', lambda: write_file('/proc/sys/kernel/core_pattern', 'x'))
    attempt('run-from-scratch', 'a program copied into the scratch space', run_from_scratch)

    # 3. Reach anything outside.
    attempt('network', 'tcp 1.1.1.1:80', lambda: tcp('1.1.1.1', 80))
    attempt('network', 'tcp6 2606:4700:4700::1111:80', lambda: tcp('2606:4700:4700::1111', 80, socket.AF_INET6))
    attempt('network', 'udp 8.8.8.8:53', lambda: udp('8.8.8.8', 53))
    attempt('network', 'dns example.com', lambda: socket.getaddrinfo('example.com', 80)[0][4][0])
    attempt('network', 'raw packet socket', lambda: socket.socket(socket.AF_PACKET, socket.SOCK_RAW).close() or 'opened')
    attempt('network', 'netlink socket', lambda: socket.socket(socket.AF_NETLINK, socket.SOCK_RAW, 0).close() or 'opened')
    attempt('network', 'tcp 127.0.0.1:22 (the host\'s own)', lambda: tcp('127.0.0.1', 22))
    for target in opts['--tcp']:
        host, port = target.rsplit(':', 1)
        attempt('network', f'tcp {target} (a listener on the host)', lambda host=host, port=port: tcp(host, int(port)))
    for path in ['/run/dbus/system_bus_socket', '/run/systemd/private', '/run/systemd/journal/socket', '/run/systemd/notify', '/var/run/docker.sock', '/run/tala-render/render.sock',
                 '\0/tmp/.X11-unix/X0', '\0/org/kernel/linux/storage/multipathd'] + opts['--unix']:
        attempt('unix-socket', path.replace('\0', '@'), lambda path=path: unix(path))

    # 4. Become more than it is.
    attempt('privilege', 'setuid(0)', lambda: c_call('setuid', 0))
    attempt('privilege', 'setgid(0)', lambda: c_call('setgid', 0))
    attempt('privilege', 'chroot', lambda: c_call('chroot', SCRATCH.encode()))
    attempt('privilege', 'mount a file system', lambda: c_call('mount', b'none', SCRATCH.encode(), b'tmpfs', 0, None))
    attempt('privilege', 'new user namespace', lambda: c_call('unshare', 0x10000000))
    attempt('privilege', 'new mount namespace', lambda: c_call('unshare', 0x00020000))
    attempt('privilege', 'new network namespace', lambda: c_call('unshare', 0x40000000))
    attempt('privilege', 'make a device node', lambda: c_call('mknod', os.path.join(SCRATCH, 'dev-null').encode(), 0o020666, os.makedev(1, 3)))
    attempt('privilege', 'ptrace process 1', lambda: ptrace_attach(1))
    attempt('privilege', 'signal process 1 (signal 0: a question, not a kill)', lambda: os.kill(1, 0) or 'allowed')
    for pid in opts['--pid']:
        attempt('other-process', f'signal process {pid} of the tester (signal 0)', lambda pid=pid: os.kill(int(pid), 0) or 'allowed')
    attempt('privilege', 'raise own file-size limit', lambda: raise_limit())
    params = ctypes.create_string_buffer(120)
    attempt('io-uring', 'io_uring_setup', lambda: io_uring(425, 4, params))
    attempt('io-uring', 'io_uring_enter', lambda: io_uring(426, -1, 0, 0, 0, None, 0))
    attempt('io-uring', 'io_uring_register', lambda: io_uring(427, -1, 0, None, 0))
    for cmd in (['/usr/bin/sudo', '-n', 'true'], ['/usr/bin/su', '-c', 'true'], ['/usr/bin/newuidmap'], ['/usr/bin/mount', '-t', 'tmpfs', 'none', SCRATCH], ['/usr/bin/ping', '-c', '1', '-W', '1', '127.0.0.1']):
        attempt('setuid-program', ' '.join(cmd), lambda cmd=cmd: run_ok(cmd))
    say(kind='end')


def run_from_scratch():
    target = os.path.join(SCRATCH, 'copied-true')
    with open('/usr/bin/true', 'rb') as src, open(target, 'wb') as dst:
        dst.write(src.read())
    os.chmod(target, 0o755)
    try:
        subprocess.run([target], check=True, timeout=5)
        return 'it ran'
    finally:
        os.unlink(target)


def run_ok(cmd):
    if not os.path.exists(cmd[0]):
        raise FileNotFoundError(errno.ENOENT, 'not installed')
    r = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
    if r.returncode != 0:
        raise PermissionError(errno.EPERM, f'exit {r.returncode}')
    return 'exit 0'


def ptrace_attach(pid):
    libc.ptrace.restype = ctypes.c_long
    ctypes.set_errno(0)
    r = libc.ptrace(16, pid, None, None)  # PTRACE_ATTACH
    if r != 0:
        e = ctypes.get_errno()
        raise OSError(e or errno.EPERM, os.strerror(e or errno.EPERM))
    libc.ptrace(17, pid, None, None)  # PTRACE_DETACH, at once
    return 'attached'


def raise_limit():
    import resource
    soft, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
    resource.setrlimit(resource.RLIMIT_FSIZE, (resource.RLIM_INFINITY, resource.RLIM_INFINITY))
    return f'was {soft}/{hard}, now unlimited'


def memory():
    held = []
    step = 16 * 1024 * 1024
    while True:
        block = bytearray(step)
        for i in range(0, step, 4096):
            block[i] = 1
        held.append(block)
        say(kind='memory', mib=len(held) * 16)


def processes():
    made = 0
    try:
        while True:
            pid = os.fork()
            if pid == 0:
                time.sleep(600)
                os._exit(0)
            made += 1
            if made % 16 == 0:
                say(kind='processes', started=made)
    except OSError as e:
        say(kind='processes', started=made, stopped_by=err_name(e))
    say(kind='end')


def storm():
    say(kind='storm', note='forking without limit for 5 seconds')
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            os.fork()
        except OSError:
            time.sleep(0.01)
    os._exit(0)


def writable_places():
    places = []
    for d in [SCRATCH, '/var/tmp', '/dev/shm', '/run', '/dev/mqueue', '/']:
        try:
            write_dir(d)
            places.append(d)
        except BaseException:  # noqa: BLE001
            pass
    return places


def disk():
    chunk = b'\xa5' * (4 * 1024 * 1024)
    for d in writable_places():
        total = 0
        n = 0
        stopped = 'nothing'
        try:
            while True:
                with open(os.path.join(d, f'fill-{n}'), 'wb') as f:
                    for _ in range(16):
                        f.write(chunk)
                        total += len(chunk)
                n += 1
        except OSError as e:
            stopped = err_name(e)
        say(kind='disk', place=d, mib=total // (1024 * 1024), stopped_by=stopped)
    count = 0
    stopped = 'nothing'
    try:
        os.makedirs(os.path.join(SCRATCH, 'many'), exist_ok=True)
        while count < 200000:
            open(os.path.join(SCRATCH, 'many', str(count)), 'wb').close()
            count += 1
    except OSError as e:
        stopped = err_name(e)
    say(kind='disk-files', place=SCRATCH, files=count, stopped_by=stopped)
    say(kind='end')


def bigfile():
    chunk = b'\x5a' * (4 * 1024 * 1024)
    total = 0
    stopped = 'nothing'
    try:
        with open(os.path.join(SCRATCH, 'big'), 'wb') as f:
            while True:
                f.write(chunk)
                f.flush()
                total += len(chunk)
    except OSError as e:
        stopped = err_name(e)
    say(kind='bigfile', mib=total // (1024 * 1024), stopped_by=stopped)
    say(kind='end')


def cpu():
    say(kind='cpu', note='spinning')
    x = 0
    while True:
        x = (x * 1103515245 + 12345) % 2147483648


def sleep():
    say(kind='sleep', note='waiting for ever')
    while True:
        time.sleep(60)


def files():
    held = []
    try:
        while True:
            held.append(open('/dev/null', 'rb'))
    except OSError as e:
        say(kind='files', opened=len(held), stopped_by=err_name(e))
    say(kind='end')


def orphans():
    """Processes that leave the job's session and process group and ignore every signal that can be ignored."""
    pids = []
    for _ in range(4):
        r, w = os.pipe()
        if os.fork() == 0:
            os.setsid()
            if os.fork() == 0:
                for s in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT, signal.SIGPIPE):
                    signal.signal(s, signal.SIG_IGN)
                os.write(w, str(os.getpid()).encode())
                os.close(w)
                for fd in (0, 1, 2):
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                while True:
                    time.sleep(60)
            os._exit(0)
        os.close(w)
        pids.append(int(os.read(r, 32).decode() or 0))
        os.close(r)
        os.wait()
    left = []
    for d in writable_places():
        try:
            with open(os.path.join(d, 'left-behind'), 'w') as f:
                f.write('from an earlier job')
            left.append(d)
        except OSError:
            pass
    say(kind='orphans', pids=pids, files_left_in=left)
    say(kind='end')


def crash():
    """Dies the way a broken program does. Whether the kernel made a memory image of it is for the tester to see."""
    say(kind='crash', pid=os.getpid(), cwd=os.getcwd())
    os.chdir(SCRATCH)
    signal.signal(signal.SIGSEGV, signal.SIG_DFL)
    os.kill(os.getpid(), signal.SIGSEGV)
    time.sleep(5)


MODES = {'survey': survey, 'memory': memory, 'processes': processes, 'storm': storm, 'disk': disk, 'bigfile': bigfile, 'cpu': cpu, 'sleep': sleep, 'files': files, 'orphans': orphans, 'crash': crash}

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode not in MODES:
        sys.stderr.write(__doc__)
        sys.exit(2)
    if mode == 'survey':
        survey(sys.argv[2:])
    else:
        MODES[mode]()
