"""OS-enforced limits installed before the parser accepts document bytes."""
import os

_job_handle = None


def install_limits():
    global _job_handle
    cap = 768 * 1024 * 1024
    if os.name != "nt":
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
        return
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ["ReadOperationCount", "WriteOperationCount",
            "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount"]]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = ExtendedLimits()
    # Bound the parser and its converter together. Closing the last job handle
    # kills descendants when the parent timeout terminates the parser.
    limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x100 | 0x200 | 0x8
    limits.BasicLimitInformation.ActiveProcessLimit = 2
    limits.ProcessMemoryLimit = cap
    limits.JobMemoryLimit = cap
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()):
        if handle:
            kernel.CloseHandle(handle)
        raise RuntimeError("The isolated parser could not enforce its memory limit")
    _job_handle = handle  # Kept alive for this process; never inherited by child converters.
