/** Taiwan term table of the zh-TW decision file (section 6) and the context
 * rules that keep Chinese words with two senses from being rewritten blindly. */
import { describe, expect, it } from 'vitest'
import { loadTraditionalConverter, toTraditional, toTraditionalMarkdown } from '../src/client/traditional.ts'

const convert = await loadTraditionalConverter()
const cases = (rows: readonly (readonly [string, string])[]): void => {
  for (const [input, expected] of rows) expect(toTraditional(input, convert), input).toBe(expected)
}

describe('decision table', () => {
  it('rewrites each row of the table', () => {
    cases([
      ['新会话', '新工作階段'],
      ['子智能体', '子代理'],
      ['退出登录', '登出'],
      ['退出登录可能会中断任务', '登出可能會中斷任務'],
      ['注册表', '註冊表'],
      ['向用户展示', '向使用者展示'],
      ['协议', '協定'],
      ['安装源', '安裝來源'],
      ['默认下载源', '預設下載來源'],
      ['可复用', '可重複使用'],
      ['自定义', '自訂'],
      ['反馈', '意見回饋'],
      ['API 前缀', 'API 前綴'],
      ['网页获取', '網頁擷取'],
      ['获取模型列表', '取得模型列表'],
      ['并为智能体设置', '並為代理設定'],
      ['保留并发送', '保留並發送'],
      ['一并删除', '一併刪除'],
      ['发送“继续”', '傳送「繼續」'],
      ['“A”和“B”', '「A」和「B」'],
    ])
  })

  it('keeps apostrophes and ASCII quotes', () => {
    cases([['don’t 保存', 'don’t 儲存'], ['发送"x"', '傳送"x"']])
  })

  it('maps 包 to 套件 in the package sense only', () => {
    cases([
      ['插件包', '外掛套件'],
      ['包名', '套件名稱'],
      ['当前包', '目前套件'],
      ['待执行的包', '待執行的套件'],
      ['支持 npm 包、Git 仓库', '支援 npm 套件、Git 儲存庫'],
      ['输入插件的包名、GitHub 仓库地址', '輸入外掛的套件名稱、GitHub 儲存庫位址'],
      ['压缩包', '壓縮檔'],
      ['包括敏感操作', '包括敏感操作'],
      ['包含模型', '包含模型'],
      ['包裹内容', '包裹內容'],
    ])
  })

  it('keeps administrator back ends and terminal ends apart from background and terminal', () => {
    cases([
      ['后台任务', '背景任務'],
      ['在后台运行', '在背景執行'],
      ['管理后台', '管理後台'],
      ['后台管理页', '後台管理頁'],
      ['按配置管理后台运行和权限申请', '按設定管理背景執行和權限申請'],
      ['打开终端', '開啟終端機'],
      ['终端用户', '終端使用者'],
      ['终端设备', '終端裝置'],
      ['邮箱地址', '電子郵件地址'],
      ['服务器地址', '伺服器位址'],
    ])
  })

  it('maps 访问 to 存取 for access and to 瀏覽 for pages', () => {
    cases([
      ['远程访问控制', '遠端存取控制'],
      ['没有访问权限', '沒有存取權限'],
      ['正在访问网页', '正在瀏覽網頁'],
      ['访问网站', '瀏覽網站'],
    ])
  })
})

describe('r2 term fixes', () => {
  it('keeps 合併 and fixes only the conjunction 並', () => {
    cases([
      ['合并为一个文件', '合併為一個檔案'],
      ['合并将在后台运行', '合併將在背景執行'],
      ['压缩合并', '壓縮合併'],
      ['兼并为一体', '兼併為一體'],
      ['一并删除', '一併刪除'],
      ['并为智能体设置', '並為代理設定'],
    ])
  })

  it('adds the mainland terms Taiwan readers notice', () => {
    cases([
      ['只读文件', '唯讀檔案'],
      ['开放平台', '開放平台'],
      ['全局设置', '全域設定'],
      ['全局性已停用', '全域性已停用'],
      ['声明了安装脚本', '聲明了安裝指令碼'],
      ['赞、踩和补充意见', '讚、踩和補充意見'],
      ['赞踩按钮', '讚踩按鈕'],
      ['下载的安装包校验失败', '下載的安裝檔校驗失敗'],
      ['响应式布局', '響應式佈局'],
      ['响应较快', '回應較快'],
      ['包头', '包頭'],
    ])
  })

  it('keeps 只讀取 and 已安裝包 out of the 唯讀 and 安裝檔 rules', () => {
    cases([
      ['只读取一次', '只讀取一次'],
      ['它只读取用户设置的源', '它只讀取使用者設定的源'],
      ['只读模式', '唯讀模式'],
      ['已安装包', '已安裝套件'],
      ['安装包校验失败', '安裝檔校驗失敗'],
    ])
  })

  it('stops URL protection at the first Han character', () => {
    const out = toTraditional('访问 https://example.com/文档查看设置', convert)
    expect(out.startsWith('存取 https://example.com/')).toBe(true)
    expect(out).not.toMatch(/文档|设置/u)
  })

  it('protects code spans delimited by several backticks', () => {
    expect(toTraditionalMarkdown('见 ``失败: `设置` 为空`` 与 `x` 设置', convert)).toBe('見 ``失败: `设置` 为空`` 與 `x` 設定')
  })

  it('does not swallow the rest of a document after an empty fence', () => {
    const out = toTraditionalMarkdown('```\n```\n\n设置\n\n```\n设置\n```\n', convert)
    expect(out).toBe('```\n```\n\n設定\n\n```\n设置\n```\n')
  })
})

describe('通過', () => {
  it.each([
    ['通过命令压缩会话', '透過命令壓縮工作階段'],
    ['通过 JSON-RPC 驱动', '透過 JSON-RPC 驅動'],
    ['让用户通过 @ 引用文件', '讓使用者透過 @ 引用檔案'],
    ['通过/compact命令', '透過/compact命令'],
    ['通过 {name} 访问', '透過 {name} 存取'],
    ['GitHub 通过 gh 命令行访问', 'GitHub 透過 gh 命令列存取'],
  ])('keeps the "by means of" sense as 透過: %s', (input, expected) => {
    expect(toTraditional(input, convert)).toBe(expected)
  })

  it.each([
    '已下载并通过校验',
    '已下载并通过校验，可以安装',
    '通过后自动合并',
    '通过率',
    '测试已全部通过并合并',
    '只有通过验证才能继续',
    '审查通过',
    '检查已通过。',
    '未通过',
    '是否通过',
  ])('keeps the "passed" sense as 通過: %s', (input) => {
    const out = toTraditional(input, convert)
    expect(out).toContain('通過')
    expect(out).not.toContain('透過')
  })
})

describe('Markdown documents', () => {
  it('converts prose and leaves code, link destinations, HTML and URLs alone', () => {
    const md = [
      '# 设置插件',
      '',
      '请打开 [文档](https://example.com/设置) 并运行：',
      '',
      '```bash',
      'dsh 设置 --项目 /compact',
      '```',
      '',
      '行内 `设置` 与 ![图](./图片/设置.png) 及 <a href="设置.html">链接</a>。',
      '',
      '~~~',
      '默认',
      '~~~',
    ].join('\n')
    const out = toTraditionalMarkdown(md, convert)
    expect(out).toContain('# 設定外掛')
    expect(out).toContain('請開啟 [文件](https://example.com/设置) 並執行：')
    expect(out).toContain('```bash\ndsh 设置 --项目 /compact\n```')
    expect(out).toContain('`设置`')
    expect(out).toContain('![圖](./图片/设置.png)')
    expect(out).toContain('<a href="设置.html">連結</a>')
    expect(out).toContain('~~~\n默认\n~~~')
  })

  it('converts large documents with many protected spans', () => {
    const md = Array.from({ length: 9000 }, (_, i) => `第${i}行 \`设置${i}\` 设置`).join('\n')
    const out = toTraditionalMarkdown(md, convert)
    expect(out.split('\n')).toHaveLength(9000)
    expect(out).toContain('`设置8999` 設定')
  })
})
