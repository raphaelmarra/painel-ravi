// shmshim: emula SysV shared memory (shmget/shmat/shmdt/shmctl) com memfd.
// Motivo: o kernel Android do S20 nao tem CONFIG_SYSVIPC; o PostgreSQL cria
// sempre um segmento SysV pequeno de intertravamento. Carregar so no Postgres
// via LD_PRELOAD. Segmentos herdam por fork (MAP_SHARED de memfd).
#define _GNU_SOURCE
#include <sys/ipc.h>
#include <sys/shm.h>
#include <sys/mman.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>

#define MAXSEG 64
struct seg { int used; key_t key; int fd; size_t size; void *addr; int nattch; int rm; };
static struct seg segs[MAXSEG];
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;

static void release(struct seg *s) { close(s->fd); memset(s, 0, sizeof *s); }

int shmget(key_t key, size_t size, int flg) {
  pthread_mutex_lock(&mu);
  int i, r = -1;
  if (key != IPC_PRIVATE)
    for (i = 0; i < MAXSEG; i++)
      if (segs[i].used && segs[i].key == key) {
        if ((flg & IPC_CREAT) && (flg & IPC_EXCL)) errno = EEXIST; else r = i;
        goto out;
      }
  if (!(flg & IPC_CREAT)) { errno = ENOENT; goto out; }
  for (i = 0; i < MAXSEG && segs[i].used; i++);
  if (i == MAXSEG) { errno = ENOSPC; goto out; }
  int fd = memfd_create("pg-sysv-shm", MFD_CLOEXEC);
  if (fd < 0 || ftruncate(fd, size) < 0) { if (fd >= 0) close(fd); goto out; }
  segs[i] = (struct seg){ 1, key, fd, size, NULL, 0, 0 };
  r = i;
out:
  pthread_mutex_unlock(&mu);
  return r;
}

void *shmat(int id, const void *want, int flg) {
  if (id < 0 || id >= MAXSEG || !segs[id].used) { errno = EINVAL; return (void *)-1; }
  int prot = (flg & SHM_RDONLY) ? PROT_READ : PROT_READ | PROT_WRITE;
  void *p = mmap((void *)want, segs[id].size, prot, MAP_SHARED | (want ? MAP_FIXED : 0), segs[id].fd, 0);
  if (p == MAP_FAILED) return (void *)-1;
  pthread_mutex_lock(&mu); segs[id].addr = p; segs[id].nattch++; pthread_mutex_unlock(&mu);
  return p;
}

int shmdt(const void *addr) {
  pthread_mutex_lock(&mu);
  for (int i = 0; i < MAXSEG; i++)
    if (segs[i].used && segs[i].addr == addr) {
      munmap((void *)addr, segs[i].size);
      segs[i].addr = NULL;
      if (--segs[i].nattch <= 0 && segs[i].rm) release(&segs[i]);
      pthread_mutex_unlock(&mu);
      return 0;
    }
  pthread_mutex_unlock(&mu);
  errno = EINVAL;
  return -1;
}

int shmctl(int id, int cmd, struct shmid_ds *buf) {
  if (id < 0 || id >= MAXSEG || !segs[id].used) { errno = EINVAL; return -1; }
  pthread_mutex_lock(&mu);
  int r = 0;
  switch (cmd) {
    case IPC_STAT:
      memset(buf, 0, sizeof *buf);
      buf->shm_segsz = segs[id].size;
      buf->shm_nattch = segs[id].nattch;
      buf->shm_perm.__key = segs[id].key;
      buf->shm_perm.uid = buf->shm_perm.cuid = getuid();
      buf->shm_perm.mode = 0600;
      break;
    case IPC_RMID:
      segs[id].rm = 1;
      if (segs[id].nattch <= 0) release(&segs[id]);
      break;
    case IPC_SET: break;
    default: errno = EINVAL; r = -1;
  }
  pthread_mutex_unlock(&mu);
  return r;
}
