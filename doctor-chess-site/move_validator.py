"""Reusable Node process for the shared chess rules."""

import atexit
from contextlib import suppress
import json
import queue
import subprocess
import threading


class ValidationUnavailable(Exception):
    pass


class MoveValidator:
    def __init__(self, base, timeout=5):
        self.base = base
        self.timeout = timeout
        self.lock = threading.Lock()
        self.process = None
        self.inbox = None
        atexit.register(self.close)

    @staticmethod
    def _exchange(process, inbox):
        with suppress(OSError), process.stdin, process.stdout:
            while (job := inbox.get()) is not None:
                request, answer = job
                try:
                    process.stdin.write(request + "\n")
                    process.stdin.flush()
                    line = process.stdout.readline()
                    if not line:
                        answer.put(None)
                        return
                    answer.put(json.loads(line))
                except (OSError, ValueError):
                    answer.put(None)
                    return

    def _start(self):
        self.process = subprocess.Popen(
            ["node", str(self.base / "engine-runner.cjs"), "--stream"],
            cwd=self.base,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        self.inbox = queue.SimpleQueue()
        threading.Thread(
            target=self._exchange, args=(self.process, self.inbox), daemon=True
        ).start()

    def _stop(self):
        process, inbox = self.process, self.inbox
        self.process = self.inbox = None
        if process is None:
            return
        inbox.put(None)
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass

    def close(self):
        with self.lock:
            self._stop()

    def validate(self, request):
        with self.lock:
            try:
                if self.process is None or self.process.poll() is not None:
                    self._stop()
                    self._start()
                answer = queue.SimpleQueue()
                self.inbox.put((json.dumps(request), answer))
                result = answer.get(timeout=self.timeout)
                if not isinstance(result, dict) or (
                    "error" not in result
                    and not {"state", "result", "message"} <= result.keys()
                ):
                    raise ValidationUnavailable()
                return result
            except (OSError, queue.Empty, ValidationUnavailable) as error:
                self._stop()
                raise ValidationUnavailable() from error
