# 社媒原生获取真实验证

核对日期：2026-10-22。使用一次性未登录 Profile、独立 Project 与 BMW 当前 browser／原生媒体链路。未调用 yt-dlp，未增加 TikTok 适配。下面结果仅覆盖所列公开视频与当时网络条件。

| 平台与目标 | 接受结果 | 原生获取与完整性 |
|---|---|---|
| [X：historyinmemes](https://x.com/historyinmemes/status/1790637656616943991) | 通过 | 原帖媒体 ID 1790637589910654976；HLS，728×720 AVC＋AAC 双声道，15.557秒；下载6.860秒，复测28.078秒 |
| [X：TopHeroes](https://x.com/TopHeroes_/status/2001950365332455490) | 通过 | 原帖媒体 ID 2001841416071450628；HLS，720×720 AVC＋AAC 双声道，30.325秒；下载18.545秒。原帖内容本身为游戏推广，并非插入的前贴片广告 |
| [微博：4797699866951785](https://weibo.com/tv/show/1034:4797699866951785) | 通过 | HTTP，1920×1080 AVC＋AAC 双声道，75.953秒；下载1.070秒 |
| [微博：4967272104787984](https://video.weibo.com/show?fid=1034:4967272104787984) | 通过 | 重定向到同目标专页；HTTP，3840×2160 AVC＋AAC 双声道，85.426秒；下载11.817秒 |
| [YouTube：jNQXAC9IVRw](https://www.youtube.com/watch?v=jNQXAC9IVRw) | 未通过 | 目标身份一致，当前 SABR/UMP 分发没有可用完整直链 |
| [YouTube：a9LDPn-MO4I](https://www.youtube.com/watch?v=a9LDPn-MO4I) | 未通过 | 目标身份一致，当前 SABR/UMP 分发没有可用完整直链；完整文件候选403 |

四个成功样本均完成双轨完整解码、原始分发包证据核对和首／中／尾画面检查。AAC 为44.1kHz双声道；这不等于人工听感验收。耗时为实际原生获取阶段，不含页面加载和审阅，网络波动明显，不据此保证速度。

另将真实 X 回复中的两个 HLS 地址交给原帖的 Host 转移准备，均返回 `VIDEO_IDENTITY_UNBOUND`，同时原帖仍成功获取；分别来自媒体 ID `1776251104457535488`、`1790639511732678657`。目标绑定兼容新 X 页面缺少 data-testid/time 的主帖日期链接，但仍要求原帖链接及封面媒体 ID 一致，不能把全页网络请求当原帖证据。

YouTube 的同目标完整直链分离合并已在隔离夹具核对包数、负载哈希、PTS、起止覆盖及全片解码；真实网站没有取得合格两轨，不能声明真实合并可用。没有静默改用录制。后续进入 [YOUTUBE-01](../plans/YOUTUBE_NATIVE_ACQUISITION.md)。

本机完整证据位于被 Git 忽略的 `.bmw-runtime/social-chain-live-20261022/`：`summary.json`、`report.html`、`run-1/results.json`、`run-2/results.json`、`reply-negative/results.json`；媒体、Profile、网络运行日志不随本报告上传。该记录不宣称付费模型、已登录生产 Profile、其他视频或整站覆盖。
