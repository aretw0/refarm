# farm fix — rodar como root no Docker Desktop

Cole esse único comando no terminal root do Docker Desktop:

```
echo IyEvYmluL2Jhc2gKVD0iJHsxOi12c2NvZGV9IjsgUD0iJHsyOi0vd29ya3NwYWNlcy9yZWZhcm19IgpJPSQobWt0ZW1wIC90bXAvZmFybS5YWFhYWFguc2gpOyBjaG1vZCA2NDQgIiRJIgpwcmludGYgJ1sgLWYgL2hvbWUvJXMvLmJhc2hyYyBdJiYuIC9ob21lLyVzLy5iYXNocmNcbmV4cG9ydCBIT01FPS9ob21lLyVzIFVTRVI9JXNcbmV4cG9ydCBOUE1fQ09ORklHX1BSRUZJWD0vaG9tZS8lcy8ubnBtLWdsb2JhbFxuZXhwb3J0IFBBVEg9L2hvbWUvJXMvLm5wbS1nbG9iYWwvYmluOi9ob21lLyVzLy5jYXJnby1sb2NhbC9iaW46L2hvbWUvJXMvLmxvY2FsL2JpbjovdXNyL2xvY2FsL2NhcmdvL2JpbjokUEFUSFxuZXhwb3J0IENBUkdPX0hPTUU9L3Vzci9sb2NhbC9jYXJnbyBSVVNUVVBfSE9NRT0vdXNyL2xvY2FsL3J1c3R1cCBDQVJHT19URVJNX0NPTE9SPWFsd2F5c1xuY2QgJXM7cm0gLWYgJXNcbicgXAogICIkVCIgIiRUIiAiJFQiICIkVCIgIiRUIiAiJFQiICIkVCIgIiRUIiAiJFAiICIkSSIgPiAiJEkiCmV4ZWMgc3UgLXMgL2Jpbi9iYXNoICIkVCIgLS0gLS1pbml0LWZpbGUgIiRJIgo= | base64 -d > /usr/local/bin/farm && chmod +x /usr/local/bin/farm
```

Depois rode `farm`.

---

O que o script faz ao ser chamado:
1. Cria arquivo temporário com `chmod 644` (legível pelo vscode)
2. Escreve setup de ambiente via `printf` (sem heredoc)
3. `exec su -s /bin/bash vscode -- --init-file <tmp>` — bash herda o PTY corretamente, sem avisos de job control
