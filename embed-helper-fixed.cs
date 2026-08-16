using System;
using System.Runtime.InteropServices;

class EmbedHelper
{
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int SetWindowLong(IntPtr window, int index, uint value);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetWindowLong(IntPtr window, int index);

    [DllImport("kernel32.dll")]
    static extern void SetLastError(uint errorCode);

    const int GWL_STYLE = -16;
    const uint WS_CHILD = 0x40000000;
    const uint WS_POPUP = 0x80000000;
    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOMOVE = 0x0002;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_FRAMECHANGED = 0x0020;
    const uint SWP_SHOWWINDOW = 0x0040;

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2 || args[0] != "embed")
            {
                Console.WriteLine("ERR:usage");
                return 1;
            }

            long value;
            if (!long.TryParse(args[1], out value))
            {
                Console.WriteLine("ERR:bad_hwnd");
                return 1;
            }

            return Embed(new IntPtr(value));
        }
        catch (Exception exception)
        {
            Console.WriteLine("ERR:" + exception.Message);
            return 1;
        }
    }

    static IntPtr FindDesktopIconHost()
    {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;

        IntPtr ignored;
        SendMessageTimeout(progman, 0x052C, UIntPtr.Zero, IntPtr.Zero, 0, 1000, out ignored);

        if (FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
            return progman;

        IntPtr worker = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
        while (worker != IntPtr.Zero)
        {
            if (FindWindowEx(worker, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                return worker;
            worker = FindWindowEx(IntPtr.Zero, worker, "WorkerW", null);
        }

        return IntPtr.Zero;
    }

    static int Embed(IntPtr window)
    {
        IntPtr desktopHost = FindDesktopIconHost();
        if (desktopHost == IntPtr.Zero)
        {
            Console.WriteLine("ERR:no_desktop_host");
            return 1;
        }

        uint style = GetWindowLong(window, GWL_STYLE);
        SetWindowLong(window, GWL_STYLE, (style & ~WS_POPUP) | WS_CHILD);

        SetLastError(0);
        IntPtr previousParent = SetParent(window, desktopHost);
        int error = Marshal.GetLastWin32Error();
        if (previousParent == IntPtr.Zero && error != 0)
        {
            Console.WriteLine("ERR:setparent:" + error);
            return 1;
        }

        SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

        Console.WriteLine("OK:parent=" + desktopHost.ToInt64());
        return 0;
    }
}
