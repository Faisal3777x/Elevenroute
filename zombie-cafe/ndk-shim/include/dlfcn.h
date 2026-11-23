#pragma once
#ifdef __cplusplus
extern "C" {
#endif
#define RTLD_LAZY 1
typedef struct {
  const char* dli_fname;
  void* dli_fbase;
  const char* dli_sname;
  void* dli_saddr;
} Dl_info;
void* dlopen(const char* filename, int flag);
void* dlsym(void* handle, const char* symbol);
int dladdr(const void* addr, Dl_info* info);
#ifdef __cplusplus
}
#endif
