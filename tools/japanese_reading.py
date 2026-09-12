"""One bounded, offline dictionary reading request; text arrives on stdin."""
import json,sys,unicodedata,re,difflib
LETTER_NAMES=dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ','エー ビー シー ディー イー エフ ジー エイチ アイ ジェー ケー エル エム エヌ オー ピー キュー アール エス ティー ユー ブイ ダブリュー エックス ワイ ゼット'.split()))

def words(text):
    from fugashi import Tagger
    if not isinstance(text,str) or len(text)>600:
        raise ValueError('Japanese reading input is too long')
    pieces=[]
    for word in Tagger()(unicodedata.normalize('NFKC',text)):
        value=getattr(word.feature,'kana',None)
        if value and value!='*':sound=value
        elif re.fullmatch('[A-Z]{1,8}',word.surface):sound=''.join(LETTER_NAMES[c] for c in word.surface)
        else:sound=word.surface
        sound=''.join(chr(ord(c)-96) if 'ァ'<=c<='ヶ' else c for c in sound)
        pieces.append((word.surface,sound,word.feature))
    return pieces

def reading(text):return ''.join(sound for _,sound,_ in words(text))

def format_received(text,proposal=None):
    target=reading(text)
    if not proposal:
        try:
            try:from .windows_ime import convert
            except ImportError:from windows_ime import convert
            candidate=convert(target)
            if candidate and reading(candidate)==target:return {'display':candidate,'reading':target,'engine':'windows-ime'}
        except (OSError,ValueError):pass
        return {'display':text,'reading':target,'engine':'kana'}
    parts=words(proposal)
    proposed_reading=''.join(sound for _,sound,_ in parts)
    matches=difflib.SequenceMatcher(None,proposed_reading,target,autojunk=False).get_matching_blocks()
    replacements=[];offset=0
    for surface,sound,_ in parts:
        end=offset+len(sound)
        for block in matches:
            if sound and block.a<=offset and end<=block.a+block.size:
                begin=block.b+offset-block.a;replacements.append((begin,begin+len(sound),surface));break
        offset=end
    result=[];offset=0
    for begin,end,surface in sorted(replacements):
        if begin<offset:continue
        result.extend([target[offset:begin],surface]);offset=end
    result.append(target[offset:]);display=''.join(result)
    # A second dictionary read verifies the complete sentence, including context.
    if reading(display)!=target:display=target
    return {'display':display,'reading':reading(display),'engine':'model-checked'}

if __name__=='__main__':
    try:
        data=json.loads(sys.stdin.read(8192));result=format_received(data['text'],data.get('proposal')) if data.get('mode')=='format' else {'reading':reading(data['text'])}
    except Exception as error:
        result={'error':type(error).__name__}
    sys.stdout.write(json.dumps(result,ensure_ascii=False))
