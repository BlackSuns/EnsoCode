# electron-builder 平台 files 只写排除项会把整仓打进 asar

## 症状

mac 安装包 `app.asar` 里出现 `src/`、`packages/`、`.zvec-grep/`，体积比 `out/` + 生产依赖大出一两百 MB。

## 根因

`electron-builder` 把 `mac.files` / `win.files` / `linux.files` 里的字符串追加到**默认 matcher**。全局 `files` 里若已有 `from/to` FileSet，那些包含 `out/**` 的字符串会被收成独立 FileSet，默认 matcher 只剩下平台排除项。`containsOnlyIgnore()` 为真时它会插入 `**/*`，把整个项目根目录打进 asar。

## 修法

排除项一律写在顶层 `files`。不要给 `mac`/`win`/`linux` 单独加只有 `!` 的 `files`。

## 回归防线

`src/tooling/installerPackaging.test.ts` 断言平台块没有 `files:`。打包后 asar 顶层应只有 `out`、`node_modules`、`package.json`。

## 相关代码

`electron-builder.yml`

