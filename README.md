# 飞书文章同步助手

Chrome 浏览器插件，从飞书知识库/文档提取文章内容，一键同步到 CSDN 和知乎。

## 功能特性

- 从飞书文档（wiki/docs/docx）提取文章内容，支持虚拟滚动长文档
- HTML 转 Markdown，保留标题、代码块、列表、图片等格式
- 自动处理飞书 CDN 图片：预下载并重新上传到目标平台
- 同步到 CSDN 和知乎，保存为草稿供后续编辑
- 同步历史记录与平台配置管理

## 技术架构

Chrome Extension Manifest V3，基于 React + TypeScript + Tailwind CSS。

```
src/
├── content/          # 内容脚本（注入飞书页面）
│   ├── feishu.ts     # 文章提取（DOM 遍历 + 虚拟滚动处理）
│   ├── api.ts        # API 拦截
│   └── interceptor.ts
├── background/       # Service Worker（消息中转、Cookie 管理）
├── popup/            # 弹窗 UI
│   ├── pages/        # Home / History / Settings 页面
│   ├── adapters/     # 平台适配器（CSDN、知乎）
│   ├── lib/          # HTML 处理器、日志等工具
│   └── runtime/      # Chrome API 封装
└── types.ts          # 共享类型定义
```

## 开发

```bash
pnpm install
pnpm dev      # 开发模式（热更新）
pnpm build    # 构建生产版本
```

构建后在 Chrome 扩展管理页面加载 `dist` 目录即可。

## 使用说明

1. 在浏览器中登录目标平台（CSDN / 知乎）
2. 访问飞书文档页面（`*.feishu.cn/wiki/*`、`/docs/*`、`/docx/*`）
3. 点击插件图标，点击「提取文章」
4. 选择目标平台，点击同步

## 支持的平台

**CSDN**
- 自动登录检测（Cookie）
- 图片上传到华为云 OBS
- 自动添加默认标签
- 保存为草稿

**知乎**
- 自动登录检测（Cookie + XSRF Token）
- 图片二进制上传到知乎 OSS（支持飞书 CDN 认证图片）
- 飞书自定义标题块自动转换为标准 HTML 标题
- 保存为草稿

## 许可证

MIT
