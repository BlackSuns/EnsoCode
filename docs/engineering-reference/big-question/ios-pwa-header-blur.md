# iOS 独立 PWA 顶部模糊

## 症状

iOS 27 真机上，同一页面在 Safari 中正常，添加到主屏幕后聊天标题被顶部模糊覆盖。
header 没有 `filter` / `backdrop-filter`，`safe-area-inset-top` 为 0；只补实色背景无效。
展开侧栏后标题清晰，容易误判为侧栏标题有额外留白。

## 根因

问题位于 iOS 独立 PWA 窗口的顶部渲染，而非 header 自己的模糊样式。
固定层的背景和显隐会影响系统状态栏的取色及顶部效果。

真机等几何对照确认：不移动标题，仅将聊天根容器改为固定、不透明的页面层，
即可同时消除本例的标题模糊和顶部灰条。常驻透明遮罩虽然也能使标题清晰，
却会留下灰色状态栏，不能作为修复。

## 修法

仅在 `display-mode: standalone` 下，为 `.phone-chat-root` 设置
`position: fixed`、`inset: 0` 和 `background-color: var(--background)`。
保留原 header 高度、safe-area、消息区滚动和 iOS 原生键盘避让，不硬编码顶部补偿。

普通 Safari 页面不使用此固定定位：其布局视口可能高于工具栏之间的可视区域，
应继续沿用现有 `body: 100dvh` 布局。不要重新引入 JS 视口高度覆盖。

## 回归防线

- 真机检查独立 PWA 的标题清晰、状态栏底色正确，header 高度和文字位置不变。
- 开关侧栏后状态栏恢复正常，侧栏和遮罩的点击层级正确。
- 弹出键盘时输入区仍可见、可点击，与原布局几何一致；收起后恢复视口高度。
- 普通浏览器模式下聊天根容器不是固定定位；浅、深色主题下背景跟随主题。
- WebKit 页面截图不包含原生状态栏，不能单靠它判定模糊消失；需原生截图或真机目视。

## 相关代码

- [ChatScreen.tsx](../../../packages/phone/src/ChatScreen.tsx)
- [styles.css](../../../packages/phone/src/styles.css)
- [SessionDrawer.tsx](../../../packages/phone/src/SessionDrawer.tsx)
