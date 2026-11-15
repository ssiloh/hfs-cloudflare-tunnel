# hfs-cloudflare-tunnel

[HFS (HTTP File Server)](https://github.com/rejetto/hfs) 3 plugin that puts your HFS on the internet with one click, using a free **Cloudflare Quick Tunnel** (`https://<random>.trycloudflare.com`).
No Cloudflare account, domain, port forwarding or router setup is needed, and it works behind CGNAT.

[한국어 설명은 아래에 있습니다.](#한국어)

## Features
- **The address is shown right away**: as soon as Cloudflare assigns the random `*.trycloudflare.com` address, the menu-bar button shows it (with a 📋 copy button) and a notification pops up. It is also written to the HFS console log.
- **☁️ Tunnel** button in the HFS menu bar (admins only): start / stop / restart, the public address with a copy button, status and a short log.
- Optional **auto start** together with HFS. If cloudflared stops unexpectedly it is restarted with backoff.
- **Read-only for visitors from the tunnel** (on by default): they can browse, stream and download, and log in to see protected folders. Upload, delete, rename, move, new folder, comments, the admin panel and other plugins' APIs are blocked for them. Local access is not affected.
- **No localhost-admin leak.** cloudflared connects to HFS from `127.0.0.1`, and HFS gives passwordless admin to localhost by default, so without protection *every visitor would be admin*. The plugin replaces the client address of tunnel requests with the real visitor address from `Cf-Connecting-Ip`. Visitors are then treated as remote, and HFS logs, bans and antibrute see the real IP. This was verified through a real tunnel even with read-only mode off: admin APIs answer `401`.
- **cloudflared download.** If cloudflared is not found, the plugin downloads it from the official GitHub releases (Windows and Linux, x64/arm) into the plugin's storage folder. You can also point it to your own `cloudflared`.

## Install
1. Copy the `dist` folder into HFS's `plugins` folder and name it `cloudflare-tunnel`:
   ```
   hfs.exe
   plugins\cloudflare-tunnel\plugin.js
   plugins\cloudflare-tunnel\public\main.js, style.css
   ```
   Or, in the HFS admin panel, go to **Plugins → Search online** and look for `hfs-cloudflare-tunnel`.
2. Enable the plugin in **Admin → Plugins**.
3. Reload the HFS page and click **☁️ Tunnel → Start tunnel**.

## Options
| Option | Default | Meaning |
|---|---|---|
| `autoStart` | off | Start the tunnel when HFS starts |
| `readOnly` | **on** | Visitors from the tunnel can only browse / download |
| `cloudflaredPath` | – | Path to cloudflared. Empty means PATH, then automatic download |
| `target` | – | Local address to expose. Empty means this HFS: `http://127.0.0.1:<port>`, or the https port if http is off |
| `protocol` | auto | `http2` helps on networks that block UDP/QUIC |

## Notes
- Quick Tunnels are meant for testing and personal use. There is no uptime guarantee, and **the address changes every time the tunnel starts**. For a permanent address, use a named Cloudflare Tunnel with your own domain.
- Cloudflare limits Quick Tunnels (for example, 200 concurrent in-flight requests, and no Server-Sent Events).
- Quick Tunnels refuse to start if `~/.cloudflared/config.yml` exists. Rename it while you use this plugin.
- Anyone who knows the address can open your HFS. Check the permissions of your shared folders.

## Licenses
- This plugin: MIT (see `LICENSE`).
- [cloudflared](https://github.com/cloudflare/cloudflared): Apache-2.0. It is not bundled; it is downloaded from Cloudflare's GitHub releases at runtime when missing.
- [HFS](https://github.com/rejetto/hfs): GPL-3.0. This plugin only uses HFS's plugin API.
- Cloudflare Quick Tunnels are subject to [Cloudflare's terms](https://www.cloudflare.com/website-terms/).

---

## 한국어

HFS를 **Cloudflare 퀵 터널**(`https://<무작위>.trycloudflare.com`)로 인터넷에 바로 공개하는 플러그인입니다. Cloudflare 계정, 도메인, 포트포워딩이 필요 없습니다.

- **임시 주소 바로 표시**: Cloudflare가 `*.trycloudflare.com` 주소를 만들면 즉시 메뉴 버튼에 주소가 뜨고(📋 복사 버튼 포함) 알림이 나옵니다. HFS 콘솔 로그에도 남습니다.
- **☁️ 터널** 버튼(관리자만 보임): 시작 · 중지 · 새 주소로 다시 시작, 공개 주소 복사, 상태와 기록.
- **외부 접속은 열람만** (기본 켜짐): 터널로 들어온 사람은 목록 보기, 재생, 다운로드만 할 수 있습니다.
  - 보호된 폴더를 보기 위한 로그인은 가능합니다.
  - 업로드, 삭제, 이름 변경, 이동, 새 폴더, 댓글, 관리자 화면, 다른 플러그인 기능은 막힙니다.
  - 이 PC나 내부망에서 접속할 때는 영향이 없습니다.
- **localhost 관리자 노출 방지**
  - 문제: cloudflared는 127.0.0.1에서 HFS에 접속하고, HFS는 기본 설정에서 localhost를 비밀번호 없는 관리자로 취급합니다. 그대로 두면 인터넷의 누구나 관리자가 됩니다.
  - 해결: 플러그인이 터널 요청의 주소를 실제 방문자 IP(`Cf-Connecting-Ip`)로 바꿉니다.
  - 확인: 실제 터널로 시험했고, 열람 전용을 꺼도 관리자 API는 `401`로 막힙니다.
- **cloudflared 자동 설치**: cloudflared가 없으면 공식 GitHub 릴리스에서 자동으로 받습니다(Windows/Linux).
- **설치**: `dist` 폴더를 HFS의 `plugins\cloudflare-tunnel`로 복사합니다. 관리자 화면 → Plugins에서 켜고, 메뉴의 ☁️ 터널 → 터널 시작을 누르면 됩니다.
- **참고 사항**
  - 주소는 시작할 때마다 바뀝니다. 고정 주소가 필요하면 Cloudflare의 이름 있는 터널(Named Tunnel)을 쓰세요.
  - `~/.cloudflared/config.yml`이 있으면 퀵 터널이 시작되지 않습니다.
  - 주소를 아는 사람은 누구나 접속할 수 있으니 공유 폴더 권한을 확인하세요.
