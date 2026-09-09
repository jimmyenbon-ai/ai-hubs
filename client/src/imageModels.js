export const IMAGE_MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'GPT-Image 2', category: 'gpt', supportsImageSize: false },
  { value: 'gpt-image-2-vip', label: 'GPT-Image 2 VIP', category: 'gpt', supportsImageSize: true },
  { value: 'gpt-image-2.5', label: 'GPT-Image 2.5', category: 'gpt', supportsImageSize: false },
  { value: 'gpt-image-2.5-flare', label: 'GPT-Image 2.5 Flare', category: 'gpt', supportsImageSize: true },
  { value: 'gpt-image-2.5-sunburst', label: 'GPT-Image 2.5 Sunburst', category: 'gpt', supportsImageSize: true },
  { value: 'nano-banana', label: 'Nano Banana', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-fast', label: 'Nano Banana Fast', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-2', label: 'Nano Banana 2', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-2-cl', label: 'Nano Banana 2 CL (2K)', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-2-4k-cl', label: 'Nano Banana 2 4K CL', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-pro-cl', label: 'Nano Banana Pro CL (2K)', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-pro-vip', label: 'Nano Banana Pro VIP (2K)', category: 'nano', supportsImageSize: true },
  { value: 'nano-banana-pro-4k-vip', label: 'Nano Banana Pro 4K VIP', category: 'nano', supportsImageSize: true },
]

export const GPT_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter((model) => model.category === 'gpt')

export function isGptImageModel(model) {
  return GPT_IMAGE_MODEL_OPTIONS.some((item) => item.value === model)
}

export function supportsImageSize(model) {
  return IMAGE_MODEL_OPTIONS.find((item) => item.value === model)?.supportsImageSize ?? false
}
