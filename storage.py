"""Transactional local workspace storage with revision checks and recovery snapshots."""
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class ConflictError(Exception):
    def __init__(self, state):
        self.state = state


def validate_workspace(value):
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('profiles'), list):
        raise ValueError('Invalid workspace data.')
    ids = set()
    for entry in value['profiles']:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str) or not entry['id'] or entry['id'] in ids:
            raise ValueError('Profiles must have unique identifiers.')
        ids.add(entry['id'])
        profile = entry.get('profile')
        if not isinstance(profile, dict) or not isinstance(profile.get('name'), str):
            raise ValueError('Invalid profile details.')
        for key in ('experience', 'education', 'projects'):
            if not isinstance(profile.get(key), list):
                raise ValueError('Invalid resume section.')
        if not isinstance(entry.get('history'), list) or not isinstance(entry.get('notes'), str):
            raise ValueError('Invalid profile notes or history.')
    if value.get('activeId') is not None and value['activeId'] not in ids:
        raise ValueError('The active profile does not exist.')
    return {key: value.get(key) for key in ('version', 'activeId', 'profiles')}


class WorkspaceStore:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.path = self.directory / 'workspace.sqlite3'
        self.lock = threading.RLock()
        self.last_backup = 0
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('''CREATE TABLE IF NOT EXISTS snapshots (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, revision TEXT NOT NULL UNIQUE,
                body TEXT NOT NULL, checksum TEXT NOT NULL, saved_at TEXT NOT NULL)''')
        os.chmod(self.path, 0o600)
        # Keep a separate consistent database copy, including any committed WAL entries.
        with self.lock:
            with self.connect() as connection:
                self.backup(connection)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        try:
            connection.execute('PRAGMA synchronous=FULL')
            yield connection
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def backup(self, connection):
        if self.last_backup and time.monotonic() - self.last_backup < 300:
            return
        temporary = self.directory / 'workspace.backup.tmp'
        destination = sqlite3.connect(temporary)
        try:
            connection.backup(destination)
        finally:
            destination.close()
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.directory / 'workspace.backup.sqlite3')
        self.last_backup = time.monotonic()

    def read(self, connection):
        rows = connection.execute('SELECT revision, body, checksum, saved_at FROM snapshots ORDER BY sequence DESC').fetchall()
        if not rows:
            return {'workspace': None, 'revision': None, 'recovered': False}
        for index, (revision, body, checksum, saved_at) in enumerate(rows):
            try:
                if hashlib.sha256(body.encode()).hexdigest() != checksum:
                    continue
                value = validate_workspace(json.loads(body))
                return {'workspace': value, 'revision': rows[0][0], 'savedAt': saved_at, 'recovered': index > 0}
            except (ValueError, TypeError):
                continue
        raise ValueError('Saved data could not be read. Your database and backup were preserved; restore a JSON backup or recover workspace.backup.sqlite3 before continuing.')

    def load(self):
        with self.lock, self.connect() as connection:
            return self.read(connection)

    def save(self, workspace, base_revision):
        value = validate_workspace(workspace)
        body = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        with self.lock, self.connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            state = self.read(connection)
            if base_revision != state['revision']:
                raise ConflictError(state)
            revision = uuid.uuid4().hex
            saved_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            connection.execute('INSERT INTO snapshots (revision, body, checksum, saved_at) VALUES (?, ?, ?, ?)',
                               (revision, body, hashlib.sha256(body.encode()).hexdigest(), saved_at))
            connection.execute('DELETE FROM snapshots WHERE sequence NOT IN (SELECT sequence FROM snapshots ORDER BY sequence DESC LIMIT 100)')
            connection.commit()
            # Failure to refresh the secondary backup must not misreport a committed save.
            try:
                if state['workspace'] is None:
                    self.last_backup = 0
                self.backup(connection)
            except (OSError, sqlite3.Error):
                pass
            return {'revision': revision, 'savedAt': saved_at}
