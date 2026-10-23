# 社媒原生获取真实验证

核对日期：2026-10-22–23。YouTube 为本次 SABR 改进复测；X、微博为同日先前已记录实测，不冒称已在本次改动后重跑。使用一次性未登录 Profile、独立 Project 与 BMW 当前 browser／原生媒体链路。未调用 yt-dlp，未增加 TikTok 适配。下面结果仅覆盖所列公开视频与当时网络条件。

| 平台与目标 | 接受结果 | 原生获取与完整性 |
|---|---|---|
| [X：historyinmemes](https://x.com/historyinmemes/status/1790637656616943991) | 通过 | 原帖媒体 ID 1790637589910654976；HLS，728×720 AVC＋AAC 双声道，15.557秒；下载6.860秒，复测28.078秒 |
| [X：TopHeroes](https://x.com/TopHeroes_/status/2001950365332455490) | 通过 | 原帖媒体 ID 2001841416071450628；HLS，720×720 AVC＋AAC 双声道，30.325秒；下载18.545秒。原帖内容本身为游戏推广，并非插入的前贴片广告 |
| [微博：4797699866951785](https://weibo.com/tv/show/1034:4797699866951785) | 通过 | HTTP，1920×1080 AVC＋AAC 双声道，75.953秒；下载1.070秒 |
| [微博：4967272104787984](https://video.weibo.com/show?fid=1034:4967272104787984) | 通过 | 重定向到同目标专页；HTTP，3840×2160 AVC＋AAC 双声道，85.426秒；下载11.817秒 |
| [YouTube：jNQXAC9IVRw](https://www.youtube.com/watch?v=jNQXAC9IVRw) | 通过 | 原生 SABR/UMP，320×240 AVC＋AAC双声道，19.064秒；最新获取与无重编码合并1.331秒 |
| [YouTube：a9LDPn-MO4I](https://www.youtube.com/watch?v=a9LDPn-MO4I) | 通过 | 原生 SABR/UMP，1920×1080 AVC＋AAC双声道，60.047秒；最新获取与无重编码合并98.802秒 |

表中六个成功样本均完成双轨完整解码、原始分发包证据核对和首／中／尾画面检查。AAC 为44.1kHz双声道；这不等于人工听感验收。耗时为实际原生获取阶段，不含页面加载和审阅，网络波动明显，不据此保证速度。

另将真实 X 回复中的两个 HLS 地址交给原帖的 Host 转移准备，均返回 `VIDEO_IDENTITY_UNBOUND`，同时原帖仍成功获取；分别来自媒体 ID `1776251104457535488`、`1790639511732678657`。目标绑定兼容新 X 页面缺少 data-testid/time 的主帖日期链接，但仍要求原帖链接及封面媒体 ID 一致，不能把全页网络请求当原帖证据。

YouTube 由当前播放器真实 POST 的同页/CPN/config 见证启动专用原生协议 worker，接收每一分段、核对视频与格式版本、连续范围、原始编码轨道 SHA，再原生 packet-copy MP4。两条视频均通过独立包数、负载哈希、PTS、起止覆盖及全片AV解码，首中尾画面已查看。最新19秒样本获取含合并1.331秒、发现至验证总44.179秒；60秒样本分别98.802秒／128.433秒。相关源代码与JS指纹在各复测期间保持不变。后一条慢于实时长度，其中60秒最新轮显式backoff为0，不能把全部耗时归因于退避或通过修改协议时钟提速；网站、网络和接收吞吐均可能影响速度，不作统一速度承诺。

额外约10分钟样本 [aqz-KE-bpKQ](https://www.youtube.com/watch?v=aqz-KE-bpKQ) 首次149.029秒遭网站流保护验证拒绝；复测流保护允许接收，但796.930秒网络中止。两轮部分轨道均已清理，不能计作完整获取。它与94分钟目标尚未通过，见 [YOUTUBE-01](../plans/YOUTUBE_NATIVE_ACQUISITION.md)。媒体候选或 HTTP 200 不是验收，未替换为录制。人工听感与生产 Profile／付费服务覆盖均未声明。

本机完整证据位于被 Git 忽略的 `.bmw-runtime/social-chain-live-20261022/`：`summary.json`、`report.html`、`run-1/results.json`、`run-2/results.json`、`reply-negative/results.json`；媒体、Profile、网络运行日志不随本报告上传。该记录不宣称付费模型、已登录生产 Profile、其他视频或整站覆盖。


YouTube 最新详细证据：`.bmw-runtime/youtube-native-20261022/live-final-shorts/results.json` 与 `live-final-y3/results.json`（同根目录）、该目录 `project/artifacts/` 的原始两轨／MP4／安全 proof／首中尾 PNG；长片失败证据为 `live-midlength/results.json` 与 `live-mid-refresh/results.json`，两者媒体目录均为空。隔离22项针对性测试全过，含中间分段缺失／重叠、错误目标与格式、原生 POST、取消期间实际响应销毁、服务端 backoff worker 终止、失败清理隔离与显式恢复。可移植摘要见 [YouTube 验证记录](../verification/YOUTUBE_NATIVE_ACQUISITION.json)。

另一次60秒样本复测仍在30.061秒贴片广告（ad-showing=true），即使videoData/playerResponse仍提供原视频ID，门禁也拒绝原片获取，未产生错误视频；等待/跳过可见广告后重新绑定才完成原片。记录保留在 `live-final-shorts/results.json`，不把受广告阻止的这一轮计成功。
