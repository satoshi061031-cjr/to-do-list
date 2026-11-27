# dayfly · Apple Watch 开发版

独立的 watchOS 10+ App。表盘按手表所在时区显示当天已同步的个人支出，以网站账本的本位币结算。可在兼容的表盘位置添加「今日支出」。

| 表盘位置 | 显示内容 |
| --- | --- |
| 矩形 | 「今日支出」、币种、金额、上次读取的时间。适合需要查看同步状态时使用。 |
| 圆形 | 币种与金额。使用缓存时，币种旁会出现时钟。 |
| 行内 | 币种和金额在前，后面标明「今日」或「上次」。 |
| 角落 | 金额沿表盘边缘排列；支持弧形标签的位置还会显示币种和状态。 |

例如 75.30 元显示为 `CNY 75.30`。较大的金额在窄位置会随系统语言缩写，例如 123,456.78 元在简体中文下显示为 `12.3万`。轻点组件打开手表 App，或使用 VoiceOver，可查看完整金额。

## 在 Mac 上试用

1. 在仓库根目录安装依赖（`npm ci`），运行 `npm run watch:demo`。保持终端打开，记下十分钟有效的配对码。演示服务只监听本机，使用内存中的虚构账本。按回车可重新出码，停止后测试配对和数据会清空。
2. 用 Xcode 打开 `watchOS/DayflyWatch.xcodeproj`，选择 **DayflyWatch** scheme 和 Apple Watch 模拟器，点击 **Run**。如没有模拟器，在 **Xcode → Settings → Components** 安装 watchOS 模拟器运行时。Debug 默认请求 `http://localhost:3000`。
3. 在手表 App 输入配对码。在手表与 Mac 日期相同时，示例显示 **CNY 75.30**，来自 54 元和按已记汇率 7.1 折算的 3 美元。另有 100 元共享支出，单独统计。
4. 长按兼容表盘（例如「模块」），点「编辑」，切到「复杂功能」，选一个位置，再选 **dayfly → 今日支出**。按数码表冠返回表盘。轻点表盘金额可打开 App 手动刷新。

在 Xcode 中打开 `SpendingWidget/SpendingWidget.swift` 并显示 Canvas，可分别预览四种位置。预览使用示例金额，也包含未配对、账本未同步、零支出和断网状态。

## 连接开发网站或真机

- 运行包含本分支改动的开发网站，并在网站上登录、同步个人账本。打开 **账本 → 右上角菜单 → 预算设置 → Apple Watch → 生成配对码**。将其输入手表即完成配对。每个账户同时连接一块手表，新码成功兑换后旧表失效；「解除手表配对」也会使尚未使用的码失效。
- 真机需要手表能访问的 **HTTPS 开发站地址**。在 Xcode 项目 Build Settings 的 `DAYFLY_SERVER_URL` 填入该地址。两个 target 均继承此设置。真机的 localhost 指手表自身。选择自己的签名团队，为 App 和 Widget 配置相同的 Keychain Sharing 组，然后运行到手表。网站版本需要提供同源的配对及合计接口。
- 配对凭证只允许读取当天合计，保存在手表与组件共享的设备钥匙串。服务端把配对关系的摘要存储在 SQLite，保留其数据卷可跨部署保留配对；数据库重置后重新配对即可。
- WidgetKit 自行安排后台更新，工程请求约每 15 分钟刷新。断网或数据达到 15 分钟时，组件会把仍有效的金额标成上次读数。到手表当地午夜，时间线会清除昨天的金额。切换时区后，下一次读取只接受新时区的合计。未同步的账本提示同步，已同步且当天没有支出时显示零。

## 账本变动后的更新

打开手表 App 时会立即读取合计，并在前台等待已配对账号的账本保存。网页或快捷指令成功保存后，App 会重新读取今日合计，并通知表盘刷新。离开 App 后结束监听，断线后自动重试。表盘仍会通过 WidgetKit 时间线独立读取。

要在手表 App 关闭时也向表盘发送更新提示，可为 watchOS 26 及以上的发行版启用 WidgetKit 推送。

1. 为手表 App 和组件配置支持 Push Notifications 的签名与描述文件。在两个 target 的构建设置中将 watchOS 部署目标设为 26 或更高，使用 `Shared/WatchPush.entitlements`，增加 Swift 编译条件 `DAYFLY_WIDGET_PUSH`，并将 `DAYFLY_APNS_SIGNING_ENVIRONMENT` 设为与描述文件一致的 `development` 或 `production`。免费个人签名使用工程的默认设置。
2. 在服务端设置 `DAYFLY_APNS_KEY_FILE`（受限挂载的 Apple .p8 密钥路径）、`DAYFLY_APNS_KEY_ID`、`DAYFLY_APNS_TEAM_ID`、`DAYFLY_APNS_WIDGET_TOPIC`（对应 Apple 授权的 bundle ID 加 `.push-type.widgets`）及 `DAYFLY_APNS_ENVIRONMENT`（`sandbox` 或 `production`）。
3. 配对并添加「今日支出」后，组件会登记推送令牌。账本保存后服务器只向 Apple 发送刷新提示，组件再用只读凭证取回合计。待发送提示保存在服务端 SQLite，替换手表或解除配对会清理订阅。

后台提示的送达和表盘刷新时间由 watchOS 调度。可轻点表盘金额，立即读一次正式账本。[Apple WidgetKit 推送说明](https://developer.apple.com/documentation/widgetkit/updating-widgets-with-widgetkit-push-notifications)
