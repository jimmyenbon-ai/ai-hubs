// 常用提示词快捷库 - 帮助设计师快速添加质量词、风格词、光效词等
import { useState } from 'react'

// 预设快捷词库
const PROMPT_PRESETS = {
  quality: {
    label: '质量词',
    icon: '✨',
    color: '#f59e0b',
    items: [
      { label: '4K高清', prompt: '4K, high resolution, detailed' },
      { label: '超高清', prompt: 'ultra-detailed, 8K, masterpiece' },
      { label: '专业级', prompt: 'professional, studio quality' },
      { label: '商业级', prompt: 'commercial quality, polished' },
      { label: '精致细节', prompt: 'intricate details, sharp focus' },
      { label: '完美无瑕', prompt: 'flawless, pristine' },
      { label: 'RAW格式', prompt: 'RAW photo, unedited' },
      { label: 'Adobe Lightroom', prompt: 'Adobe Lightroom edited' },
    ],
  },
  style: {
    label: '风格词',
    icon: '🎨',
    color: '#8b5cf6',
    items: [
      { label: '写实摄影', prompt: 'photorealistic, realistic lighting' },
      { label: '插画风格', prompt: 'illustration style, digital art' },
      { label: '扁平插画', prompt: 'flat illustration, vector art' },
      { label: '3D渲染', prompt: '3D render, C4D, octane render' },
      { label: '赛博朋克', prompt: 'cyberpunk, neon lights' },
      { label: '水彩风格', prompt: 'watercolor painting, soft edges' },
      { label: '油画风格', prompt: 'oil painting, artistic' },
      { label: '像素风格', prompt: 'pixel art, 8-bit style' },
      { label: '国潮风格', prompt: 'Chinese trendy style, traditional elements' },
      { label: '日系插画', prompt: 'Japanese anime style, manga' },
      { label: '美式漫画', prompt: 'American comic book style' },
      { label: '蒸汽朋克', prompt: 'steampunk, vintage machinery' },
    ],
  },
  lighting: {
    label: '光效词',
    icon: '💡',
    color: '#06b6d4',
    items: [
      { label: '电影光', prompt: 'cinematic lighting, dramatic' },
      { label: '自然光', prompt: 'natural lighting, soft shadows' },
      { label: '伦勃朗光', prompt: 'Rembrandt lighting' },
      { label: '蝴蝶光', prompt: 'butterfly lighting, glamour' },
      { label: '暖色调', prompt: 'warm tones, golden hour' },
      { label: '冷色调', prompt: 'cool tones, blue hour' },
      { label: '逆光', prompt: 'backlit, rim light, silhouette' },
      { label: '柔光箱', prompt: 'softbox lighting, diffused' },
      { label: '霓虹灯', prompt: 'neon lights, colorful glow' },
      { label: '散射光', prompt: 'volumetric lighting, god rays' },
    ],
  },
  composition: {
    label: '构图词',
    icon: '📐',
    color: '#10b981',
    items: [
      { label: '居中构图', prompt: 'centered composition, symmetrical' },
      { label: '三分法', prompt: 'rule of thirds, dynamic composition' },
      { label: '前景构图', prompt: 'foreground framing, depth' },
      { label: '俯视角度', prompt: 'top-down view, bird\'s eye view' },
      { label: '仰视角度', prompt: 'low angle shot, heroic perspective' },
      { label: '特写镜头', prompt: 'close-up, detailed shot' },
      { label: '全景图', prompt: 'wide shot, panoramic view' },
      { label: '全身照', prompt: 'full body shot, portrait' },
      { label: '半身照', prompt: 'half body shot, waist up' },
    ],
  },
  mood: {
    label: '氛围词',
    icon: '🌟',
    color: '#ec4899',
    items: [
      { label: '高级感', prompt: 'luxurious, elegant, premium feel' },
      { label: '治愈系', prompt: 'healing, peaceful, calming' },
      { label: '活力感', prompt: 'energetic, vibrant, dynamic' },
      { label: '科技感', prompt: 'futuristic, technological, sleek' },
      { label: '复古感', prompt: 'vintage, retro, nostalgic' },
      { label: '极简风', prompt: 'minimalist, clean, simple' },
      { label: '梦幻感', prompt: 'dreamy, ethereal, magical' },
      { label: '酷炫感', prompt: 'cool, stylish, edgy' },
      { label: '可爱风', prompt: 'cute, adorable, kawaii' },
    ],
  },
  brand: {
    label: '品牌调性',
    icon: '🏢',
    color: '#6366f1',
    items: [
      { label: '华为风格', prompt: 'Huawei style, premium tech brand' },
      { label: '苹果风格', prompt: 'Apple style, minimalist tech aesthetic' },
      { label: '小红书风', prompt: 'Xiaohongshu style, lifestyle content' },
      { label: '电商主图', prompt: 'e-commerce product photography, white background' },
      { label: 'Banner图', prompt: 'web banner, horizontal layout' },
      { label: '朋友圈图', prompt: 'WeChat Moments style, social media' },
      { label: '活动海报', prompt: 'event poster, promotional design' },
      { label: 'Logo风格', prompt: 'logo style, brand identity' },
    ],
  },
}

// 将多个prompt合并成字符串
function mergePrompts(prompts) {
  return prompts.map(p => p.trim()).filter(Boolean).join(', ')
}

function PromptQuickLibrary({ onInsert, onClose }) {
  const [selectedTab, setSelectedTab] = useState('quality')
  const [selectedItems, setSelectedItems] = useState([])
  const [searchText, setSearchText] = useState('')

  // 搜索所有分类中的词条
  const getAllItems = () => {
    const all = []
    Object.entries(PROMPT_PRESETS).forEach(([catKey, cat]) => {
      cat.items.forEach(item => {
        all.push({ ...item, category: catKey, categoryLabel: cat.label })
      })
    })
    return all
  }

  const filteredItems = searchText
    ? getAllItems().filter(item =>
        item.label.includes(searchText) || item.prompt.toLowerCase().includes(searchText.toLowerCase())
      )
    : PROMPT_PRESETS[selectedTab]?.items || []

  const handleSelectItem = (item) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.prompt === item.prompt)
      if (exists) {
        return prev.filter(i => i.prompt !== item.prompt)
      }
      return [...prev, item]
    })
  }

  const handleInsert = () => {
    if (selectedItems.length > 0) {
      const mergedPrompt = mergePrompts(selectedItems.map(i => i.prompt))
      onInsert(mergedPrompt)
    }
    setSelectedItems([])
    onClose()
  }

  const handleClear = () => {
    setSelectedItems([])
  }

  const handleQuickAdd = (prompt) => {
    onInsert(prompt)
  }

  return (
    <div className="prompt-quick-library">
      <div className="library-header">
        <div className="library-title">
          <span>💡</span> 提示词快捷库
        </div>
        <button className="library-close" onClick={onClose}>×</button>
      </div>

      {/* 搜索框 */}
      <div className="library-search">
        <input
          type="text"
          placeholder="搜索提示词..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      {/* 分类标签 */}
      <div className="library-tabs">
        {Object.entries(PROMPT_PRESETS).map(([key, cat]) => (
          <button
            key={key}
            className={`library-tab ${selectedTab === key && !searchText ? 'active' : ''}`}
            style={{ '--tab-color': cat.color }}
            onClick={() => {
              setSelectedTab(key)
              setSearchText('')
            }}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* 词条列表 */}
      <div className="library-items">
        {filteredItems.length === 0 ? (
          <div className="library-empty">没有找到相关词条</div>
        ) : (
          filteredItems.map((item, idx) => {
            const isSelected = selectedItems.some(i => i.prompt === item.prompt)
            const displayItem = searchText ? item : filteredItems[idx]
            return (
              <div
                key={displayItem.label + idx}
                className={`library-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectItem(displayItem)}
              >
                <div className="item-label">
                  {isSelected && <span className="check-icon">✓</span>}
                  {displayItem.label}
                </div>
                <div className="item-prompt">{displayItem.prompt}</div>
                <button
                  className="item-add-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleQuickAdd(displayItem.prompt)
                  }}
                  title="快速添加"
                >
                  +
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* 底部操作栏 */}
      {selectedItems.length > 0 && (
        <div className="library-footer">
          <div className="selected-count">
            已选 {selectedItems.length} 个
          </div>
          <div className="footer-actions">
            <button className="btn-clear" onClick={handleClear}>清空</button>
            <button className="btn-insert" onClick={handleInsert}>
              插入选中
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default PromptQuickLibrary
export { PROMPT_PRESETS, mergePrompts }
