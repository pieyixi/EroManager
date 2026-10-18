"""移除管理 EXE 自带图标，让 Windows 使用默认应用程序图标。"""
import argparse
import ctypes as c
import ctypes.wintypes as w
import pathlib

k = c.WinDLL('kernel32', use_last_error=True)
k.LoadLibraryExW.argtypes = [w.LPCWSTR, w.HANDLE, w.DWORD]
k.LoadLibraryExW.restype = w.HMODULE
k.FreeLibrary.argtypes = [w.HMODULE]
k.FindResourceExW.argtypes = [w.HMODULE, c.c_void_p, c.c_void_p, w.WORD]
k.FindResourceExW.restype = w.HANDLE
k.SizeofResource.argtypes = [w.HMODULE, w.HANDLE]
k.SizeofResource.restype = w.DWORD
k.LoadResource.argtypes = [w.HMODULE, w.HANDLE]
k.LoadResource.restype = w.HANDLE
k.LockResource.argtypes = [w.HANDLE]
k.LockResource.restype = c.c_void_p
NameCallback = c.WINFUNCTYPE(w.BOOL, w.HMODULE, c.c_void_p, c.c_void_p, c.c_ssize_t)
LangCallback = c.WINFUNCTYPE(w.BOOL, w.HMODULE, c.c_void_p, c.c_void_p, w.WORD, c.c_ssize_t)
k.EnumResourceNamesW.argtypes = [w.HMODULE, c.c_void_p, NameCallback, c.c_ssize_t]
k.EnumResourceLanguagesW.argtypes = [w.HMODULE, c.c_void_p, c.c_void_p, LangCallback, c.c_ssize_t]
k.BeginUpdateResourceW.argtypes = [w.LPCWSTR, w.BOOL]
k.BeginUpdateResourceW.restype = w.HANDLE
k.UpdateResourceW.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, w.WORD, c.c_void_p, w.DWORD]
k.EndUpdateResourceW.argtypes = [w.HANDLE, w.BOOL]


def resource_name(name):
    return name if isinstance(name, int) else c.cast(c.c_wchar_p(name), c.c_void_p)


def resources(module, kind):
    result = {}

    @NameCallback
    def found_name(_module, _kind, pointer, _param):
        name = pointer if pointer <= 0xffff else c.wstring_at(pointer)

        @LangCallback
        def found_language(_module, _kind, _name, lang, _param):
            handle = k.FindResourceExW(module, kind, resource_name(name), lang)
            size = k.SizeofResource(module, handle)
            data = k.LockResource(k.LoadResource(module, handle))
            result[(kind, name, lang)] = c.string_at(data, size)
            return True

        k.EnumResourceLanguagesW(module, kind, resource_name(name), found_language, 0)
        return True

    k.EnumResourceNamesW(module, kind, found_name, 0)
    return result


def inspect(executable):
    module = k.LoadLibraryExW(str(executable), None, 0x20)
    if not module:
        raise c.WinError(c.get_last_error())
    try:
        icons = resources(module, 3) | resources(module, 14)
        # 版本和清单不属于图标修订；逐资源确认它们完整保留。
        preserved = resources(module, 16) | resources(module, 24)
        return icons, preserved
    finally:
        k.FreeLibrary(module)


def remove_icons(executable):
    if executable.name != 'ero-manager-admin.exe':
        raise ValueError('Only ero-manager-admin.exe may be changed')
    icons, preserved = inspect(executable)
    if icons:
        handle = k.BeginUpdateResourceW(str(executable), False)
        if not handle:
            raise c.WinError(c.get_last_error())
        success = False
        try:
            for kind, name, lang in icons:
                if not k.UpdateResourceW(handle, kind, resource_name(name), lang, None, 0):
                    raise c.WinError(c.get_last_error())
            success = True
        finally:
            if not k.EndUpdateResourceW(handle, not success):
                raise c.WinError(c.get_last_error())
    remaining, after = inspect(executable)
    if remaining or after != preserved:
        raise RuntimeError('Icon removal or version/manifest preservation failed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=pathlib.Path)
    args = parser.parse_args()
    remove_icons(args.executable.resolve(strict=True))
    print('PASS: no embedded icons; version/manifest preserved. Explorer display requires visual verification.')
