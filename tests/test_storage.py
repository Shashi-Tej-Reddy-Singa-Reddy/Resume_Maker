import copy
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import WorkspaceStore, ConflictError


def workspace(name='Shashi'):
    return {'version': 1, 'activeId': 'person-1', 'profiles': [{
        'id': 'person-1', 'profile': {'name': name, 'summary': 'Résumé — नमस्ते',
        'experience': [], 'education': [], 'projects': []}, 'notes': 'Unfinished notes\nSecond line',
        'history': [{'id': 'saved-1', 'label': 'First version'}],
        'template': 'classic', 'paper': 'letter', 'target': {'title': 'AI Engineer'}}]}


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.store = WorkspaceStore(self.temporary.name)

    def test_round_trip_after_new_server_instance(self):
        expected = workspace()
        saved = self.store.save(expected, None)
        reloaded = WorkspaceStore(self.temporary.name).load()
        self.assertEqual(reloaded['workspace'], expected)
        self.assertEqual(reloaded['revision'], saved['revision'])
        folder_copy = Path(self.temporary.name) / 'workspace.json'
        self.assertEqual(json.loads(folder_copy.read_text()), expected)
        self.assertEqual(reloaded['storage']['directory'], str(Path(self.temporary.name).resolve()))
        backup = sqlite3.connect(Path(self.temporary.name) / 'workspace.backup.sqlite3')
        try:
            self.assertEqual(json.loads(backup.execute('SELECT body FROM snapshots ORDER BY sequence DESC LIMIT 1').fetchone()[0]), expected)
        finally:
            backup.close()

    def test_uncommitted_process_exit_preserves_acknowledged_data(self):
        expected = workspace()
        self.store.save(expected, None)
        script = '''import sqlite3, sys, os
c=sqlite3.connect(sys.argv[1]);c.execute('BEGIN IMMEDIATE')
c.execute('DELETE FROM snapshots');os._exit(17)
'''
        result = subprocess.run([sys.executable, '-c', script, str(self.store.path)])
        self.assertEqual(result.returncode, 17)
        self.assertEqual(WorkspaceStore(self.temporary.name).load()['workspace'], expected)

    def test_conflicting_sessions_cannot_overwrite_each_other(self):
        revision = self.store.save(workspace(), None)['revision']
        def save(name):
            try:
                self.store.save(workspace(name), revision)
                return 'saved'
            except ConflictError:
                return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertCountEqual(list(executor.map(save, ['One', 'Two'])), ['saved', 'conflict'])

    def test_corrupt_latest_snapshot_recovers_previous(self):
        expected = workspace()
        first = self.store.save(expected, None)
        second = self.store.save(workspace('Updated'), first['revision'])
        with self.store.connect() as connection:
            connection.execute('UPDATE snapshots SET body=? WHERE revision=?', ('broken', second['revision']))
            connection.commit()
        recovered = self.store.load()
        self.assertTrue(recovered['recovered'])
        self.assertEqual(recovered['workspace'], expected)
        repaired = self.store.save(expected, recovered['revision'])
        self.assertEqual(self.store.load()['revision'], repaired['revision'])

    def test_invalid_input_cannot_replace_saved_details(self):
        saved = self.store.save(workspace(), None)
        invalid = copy.deepcopy(workspace())
        invalid['profiles'].append(invalid['profiles'][0])
        with self.assertRaises(ValueError):
            self.store.save(invalid, saved['revision'])
        self.assertEqual(self.store.load()['workspace'], workspace())

    def test_empty_name_draft_and_profile_deletion_survive_restart(self):
        revision = self.store.save(workspace(''), None)['revision']
        self.assertEqual(WorkspaceStore(self.temporary.name).load()['workspace'], workspace(''))
        empty = {'version': 1, 'activeId': None, 'profiles': []}
        self.store.save(empty, revision)
        self.assertEqual(WorkspaceStore(self.temporary.name).load()['workspace'], empty)

    def test_corrupt_all_snapshots_fails_without_overwriting(self):
        saved = self.store.save(workspace(), None)
        with self.store.connect() as connection:
            connection.execute("UPDATE snapshots SET checksum='bad'")
            connection.commit()
        with self.assertRaises(ValueError):
            self.store.save(workspace('Replacement'), saved['revision'])
        with self.store.connect() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
