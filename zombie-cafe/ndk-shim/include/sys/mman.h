#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
#define PROT_READ 0x1
#define PROT_WRITE 0x2
#define PROT_EXEC 0x4
int mprotect(void* addr, size_t len, int prot);
#ifdef __cplusplus
}
#endif
