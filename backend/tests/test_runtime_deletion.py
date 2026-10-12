"""Account runtime deletion never force-removes busy/unowned/attached resources."""
import json
import unittest
import uuid
from unittest.mock import Mock

from backend.runtime import DockerRuntime


class RuntimeDeletionTests(unittest.TestCase):
    def setUp(self):
        self.owner = str(uuid.uuid4())
        self.name = 'btg-user-'+self.owner
        self.runtime = DockerRuntime()
        self.resources = {
            self.name: {'State': {'Running':True}, 'Config': {'Labels':{'btg.user':self.owner}}},
            self.name+'-egress': {'State':{'Running':True}, 'Config':{'Labels':{'btg.egress.user':self.owner}}}}
        self.network = {'Labels':{'btg.user':self.owner}, 'Containers':{}}
        self.runtime.inspect = Mock(side_effect=lambda name:self.resources.get(name))
        self.runtime.state = Mock(return_value={'running':True,'busy':False,'handle':self.name})
        def run(*args,**kwargs):
            if args[:2] == ('network','inspect'): return json.dumps([self.network]).encode()
            if args[0] == 'rm': self.resources.pop(args[-1],None)
            return b''
        self.runtime._run = Mock(side_effect=run)

    def test_owned_removal_then_interrupted_repeat_never_forces_or_touches_other_users(self):
        self.runtime.remove(self.owner)
        commands=[call.args for call in self.runtime._run.call_args_list]
        self.assertEqual(commands[:4], [('stop','--time=-1',self.name),('rm',self.name),
            ('stop','--time=-1',self.name+'-egress'),('rm',self.name+'-egress')])
        self.assertEqual(commands[-1],('network','rm',self.name+'-network'))
        self.assertFalse(any('-f' in args or 'kill' in args for args in commands))
        self.runtime.remove(self.owner)  # already removed containers are safe
        self.assertTrue(all(self.name in args[-1] for args in commands))

    def test_busy_or_wrong_renderer_ownership_makes_no_destructive_calls(self):
        self.runtime.state.return_value['busy']=True
        with self.assertRaisesRegex(RuntimeError,'busy'):self.runtime.remove(self.owner)
        self.runtime._run.assert_not_called()
        self.runtime.state.return_value['busy']=False
        self.resources[self.name]['Config']['Labels']['btg.user']=str(uuid.uuid4())
        with self.assertRaisesRegex(RuntimeError,'ownership'):self.runtime.remove(self.owner)
        self.runtime._run.assert_not_called()

    def test_foreign_egress_and_attached_or_foreign_network_are_preserved(self):
        self.resources[self.name+'-egress']['Config']['Labels']['btg.egress.user']='other'
        with self.assertRaisesRegex(RuntimeError,'ownership'):self.runtime.remove(self.owner)
        self.assertFalse(any(call.args[-1]==self.name+'-egress' for call in self.runtime._run.call_args_list))
        self.resources.clear()
        for network in ({'Labels':{'btg.user':'other'},'Containers':{}},
                        {'Labels':{'btg.user':self.owner},'Containers':{'unrelated':{}}}):
            self.network=network
            self.runtime._run.reset_mock()
            with self.assertRaisesRegex(RuntimeError,'network ownership'):self.runtime.remove(self.owner)
            self.assertFalse(any(call.args[:2]==('network','rm') for call in self.runtime._run.call_args_list))
