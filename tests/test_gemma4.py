import copy
import os
import unittest
from unittest.mock import patch
from ai_service import AIService
from tools.download_gemma4 import artifact, NAME

class GemmaDefaultsTests(unittest.TestCase):
    def test_default_model_is_requested_e2b(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(AIService().model, 'gemma4:e2b-it-qat')
    def test_explicit_model_preserved(self):
        with patch.dict(os.environ, {'MORSETALK_AI_MODEL': 'gemma4:e2b'}, clear=True):
            self.assertEqual(AIService().model, 'gemma4:e2b')
    def test_compatible_has_no_unrelated_default(self):
        with patch.dict(os.environ, {'MORSETALK_AI_PROVIDER': 'compatible'}, clear=True):
            self.assertEqual(AIService().model, '')

class GemmaDownloadTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {'sha': 'a'*40, 'siblings': [{'rfilename': NAME, 'lfs': {'sha256': 'b'*64, 'size': 2580000000}}]}
    def test_exact_model_revision_and_hash(self):
        self.assertEqual(artifact(self.metadata), ('a'*40, 2580000000, 'b'*64))
    def test_bad_metadata_fails_closed(self):
        cases=[]
        for key, value in [('sha', 'main'), ('siblings', []), ('siblings', [{'rfilename': 'gemma4.gguf'}])]:
            m=copy.deepcopy(self.metadata);m[key]=value;cases.append(m)
        for key,value in [('sha256','bad'),('size',0),('size',5*1024**3),('size','2580000000')]:
            m=copy.deepcopy(self.metadata);m['siblings'][0]['lfs'][key]=value;cases.append(m)
        for m in cases:
            with self.subTest(metadata=m),self.assertRaises(ValueError):artifact(m)

if __name__ == '__main__': unittest.main()
