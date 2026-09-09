const GPT_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-2-vip',
  'gpt-image-2.5',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
];

const GPT_IMAGE_PIXEL_SIZE_MODELS = [
  'gpt-image-2-vip',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
];

const SUPPORTED_NANO_MODELS = [
  'nano-banana',
  'nano-banana-fast',
  'nano-banana-2',
  'nano-banana-2-cl',
  'nano-banana-2-4k-cl',
  'nano-banana-pro',
  'nano-banana-pro-cl',
  'nano-banana-pro-vip',
  'nano-banana-pro-4k-vip',
];

const IMAGE_MODEL_POINTS = {
  'gpt-image-2': 2,
  'gpt-image-2-vip': 5,
  'gpt-image-2.5': 5,
  'gpt-image-2.5-flare': 5,
  'gpt-image-2.5-sunburst': 5,
  'nano-banana': 1,
  'nano-banana-fast': 1,
  'nano-banana-2': 2,
  'nano-banana-2-cl': 2,
  'nano-banana-2-4k-cl': 4,
  'nano-banana-pro': 1,
  'nano-banana-pro-cl': 2,
  'nano-banana-pro-vip': 2,
  'nano-banana-pro-4k-vip': 4,
};

const ALL_IMAGE_MODELS = [
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
];

module.exports = {
  ALL_IMAGE_MODELS,
  GPT_IMAGE_MODELS,
  GPT_IMAGE_PIXEL_SIZE_MODELS,
  IMAGE_MODEL_POINTS,
  SUPPORTED_NANO_MODELS,
};
