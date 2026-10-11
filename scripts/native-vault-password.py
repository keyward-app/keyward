#!/usr/bin/env python3
"""Feed a synthetic password through the CLI's real terminal prompt."""
import os
import pty
import select
import signal
import sys
import time

password = sys.stdin.read().rstrip('\n')
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
output = b''
sent = False
ended = 0
deadline = time.monotonic() + 45
while time.monotonic() < deadline:
    if select.select([fd], [], [], 0.1)[0]:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        output += chunk
        if not sent and b'password:' in output.lower():
            os.write(fd, password.encode() + b'\n')
            sent = True
    ended, status = os.waitpid(pid, os.WNOHANG)
    if ended:
        break
else:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
    sys.exit('password command timed out')
if not ended:
    _, status = os.waitpid(pid, 0)
sys.stdout.write(output.decode(errors='replace').replace(password, '[redacted]'))
sys.exit(os.waitstatus_to_exitcode(status))
