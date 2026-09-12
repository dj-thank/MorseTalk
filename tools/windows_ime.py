"""Read-only Microsoft IME conversion through the documented IFELanguage API.

Interface slots follow the Windows SDK msime.h. No keystrokes, dictionary edits,
IME settings, clipboard, or external service are used.
"""
import sys,uuid

def convert(text):
    if sys.platform!='win32' or not isinstance(text,str) or not 0<len(text)<=600:return None
    import ctypes as c
    ole=c.OleDLL('ole32');automation=c.WinDLL('oleaut32')
    pointer=c.c_void_p
    ole.CoInitialize.argtypes=[pointer]
    ole.CoUninitialize.argtypes=[];ole.CoUninitialize.restype=None
    ole.CoCreateInstance.argtypes=[pointer,pointer,c.c_ulong,pointer,c.POINTER(pointer)]
    ole.CLSIDFromProgID.argtypes=[c.c_wchar_p,pointer]
    automation.SysAllocStringLen.argtypes=[c.c_wchar_p,c.c_uint];automation.SysAllocStringLen.restype=pointer
    automation.SysFreeString.argtypes=[pointer];automation.SysFreeString.restype=None
    instance=pointer();initialized=False;opened=False
    def invoke(slot,*args):
        table=c.cast(instance,c.POINTER(c.POINTER(pointer))).contents
        signature=c.WINFUNCTYPE(c.c_long,pointer,*[t for t,_ in args])
        return signature(table[slot])(instance,*[v for _,v in args])
    try:
        ole.CoInitialize(None);initialized=True
        clsid=c.create_string_buffer(16);ole.CLSIDFromProgID('MSIME.Japan',clsid)
        iid=c.create_string_buffer(uuid.UUID('019f7152-e6db-11d0-83c3-00c04fddb82e').bytes_le)
        ole.CoCreateInstance(clsid,None,1,iid,c.byref(instance))
        if invoke(3)<0:return None
        opened=True
        source=automation.SysAllocStringLen(text,len(text));result=pointer()
        try:
            status=invoke(8,(pointer,source),(c.c_long,1),(c.c_long,-1),(c.POINTER(pointer),c.byref(result)))
            return c.wstring_at(result) if status>=0 and result else None
        finally:
            if result:automation.SysFreeString(result)
            if source:automation.SysFreeString(source)
    except (OSError,ValueError):return None
    finally:
        if instance:
            if opened:invoke(4)
            invoke(2)
        if initialized:ole.CoUninitialize()
