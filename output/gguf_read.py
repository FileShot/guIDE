import struct

def rs(f):
    l = struct.unpack('<Q', f.read(8))[0]
    return f.read(l).decode('utf-8', 'replace')

def sv(f, t):
    sizes = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,9:8,10:8,11:8}
    if t == 8:
        f.read(struct.unpack('<Q', f.read(8))[0])
    elif t == 12:
        at = struct.unpack('<I', f.read(4))[0]
        n = struct.unpack('<Q', f.read(8))[0]
        for _ in range(n):
            sv(f, at)
    elif t in sizes:
        f.read(sizes[t])

result = []
with open('D:/models/models/Qwen3-4B-Function-Calling-Pro.gguf', 'rb') as f:
    f.read(4); f.read(4)
    struct.unpack('<Q', f.read(8))[0]
    nk = struct.unpack('<Q', f.read(8))[0]
    for _ in range(nk):
        k = rs(f)
        t = struct.unpack('<I', f.read(4))[0]
        if t == 8:
            l = struct.unpack('<Q', f.read(8))[0]
            v = f.read(l).decode('utf-8', 'replace')
            if 'chat_template' in k or 'tokenizer.ggml.model' in k:
                result.append('[' + k + ']\n' + v)
        else:
            sv(f, t)

out = '\n---\n'.join(result)
with open('C:/Users/brend/IDE/output/gguf_chat_template.txt', 'w', encoding='utf-8') as f:
    f.write(out)
print('Done. Keys found:', len(result))
