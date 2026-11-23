Minimal stand-ins for the Android NDK headers that libZombieCafeExtension uses,
so it can be built with a stock clang + lld when the NDK can't be downloaded.
Only the declarations the extension needs are here, with bionic's values for
32-bit ARM. With a real NDK installed, build.sh uses that instead.
