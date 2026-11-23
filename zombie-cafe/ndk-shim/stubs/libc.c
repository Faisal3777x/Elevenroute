/* Link-time stubs: only the symbol names matter; the device's real libraries are used at run time. */
typedef unsigned int size_t;
void* malloc(size_t n) { return 0; }
void free(void* p) {}
void* memcpy(void* d, const void* s, size_t n) { return d; }
void* memset(void* d, int c, size_t n) { return d; }
size_t strlen(const char* s) { return 0; }
int mprotect(void* a, size_t l, int p) { return 0; }
