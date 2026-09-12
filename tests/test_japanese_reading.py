import importlib.util,unittest,sys
from tools.japanese_reading import reading,format_received

@unittest.skipUnless(importlib.util.find_spec('fugashi'),'Optional Japanese dictionary is not installed')
class ReadingTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform=='win32','Windows IME integration')
    def test_standard_ime_converts_received_kana_without_changing_reading(self):
        source='きょじゅうくうかんはほうしゃせんしゃへいとしげんじゅんかんしすてむがひっすじょうけんです。'
        result=format_received(source)
        self.assertEqual(result['engine'],'windows-ime')
        self.assertEqual(result['display'],'居住空間は放射線遮蔽と資源循環システムが必須条件です。')
        self.assertEqual(result['reading'],source)
    def test_reading_does_not_omit_syllables(self):
        self.assertEqual(reading('直接作用'), 'ちょくせつさよう')
        self.assertEqual(reading('AI'), 'えーあい')
    def test_format_cannot_paraphrase_received_words(self):
        source='ゆうせんじゅんいは、もくひょうにおうじてさだめるべきです。'
        result=format_received(source,'優先順位は、目標によって定めるべきです。')
        self.assertEqual(result['reading'],source)
        self.assertIn('におうじて',result['display'])
        self.assertIn('優先順位',result['display'])
    def test_a_different_word_is_not_inserted(self):
        result=format_received('わたしはねこです。','私は犬です。')
        self.assertEqual(result['reading'],'わたしはねこです。')
        self.assertNotIn('犬',result['display'])
