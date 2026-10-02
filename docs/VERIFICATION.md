# BMW 拆仓验证记录

日期：2026-10-02。全部测试在临时 userData/DSH Home/Workspace 下执行，真实用户数据未参与。

| 检查 | 结果/范围 |
|---|---|
| 独立 npm ci | 通过；每仓自己的 lockfile 和 node_modules，无另一仓路径依赖。准备阶段 ignore-scripts 后配置已安装的同版本 Electron runtime；常规 npm ci 仍使用标准 Electron 安装流程 |
| npm run build | TypeScript 编译通过 |
| npm run check | TS、源语言、功能库存检查通过 |
| npm test | 85 项单元/契约测试通过 |
| npm run test:boundaries | 6 项；单 App、继承、单工具、无反向 App/Dev import 与聊天软件默认支持 |
| npm run test:dsh-e2e | 鉴权、Preset、Session 复用/改名/搜索/历史/取消/归档 |
| npm run test:desktop-e2e | 真实 Electron Shell、临时 Profile、独立产品 Feature Graph、无 Feishu UI/IPC、第二个 Project/Session 创建 |
| npm run test:media-e2e | 7 项媒体发现；元素截图 1220×1472；HTTP 下载；真实 canvas 视频 -> WebM Capture（maximum-duration 截断，complete=false） |

现有依赖 audit 报告两个 high 项（Electron 与 extract-zip），这不被测试通过消除，详见 PROJECT_STATUS。真实模型视觉、完整视频制作、完整 WVL UI/商业 WebContainer以及所有 IPC 攻击面不在本次通过范围。

Git/迁移最终路径与基础哈希检查在迁移结束时再确认；不是从旧单仓测试结果推断。
