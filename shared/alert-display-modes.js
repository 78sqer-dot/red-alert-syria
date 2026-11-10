const MEDIA_TYPES = Object.freeze(['photo', 'video']);

export function availableAlertDisplayModes(newsText, mediaItems = []) {
  const modes = [];
  if (String(newsText ?? '').trim()) modes.push('news');
  const availableMedia = new Set((Array.isArray(mediaItems) ? mediaItems : []).map((item) => item?.type));
  for (const type of MEDIA_TYPES) if (availableMedia.has(type)) modes.push(type);
  return modes;
}

export function initialAlertDisplayMode(modes = []) {
  if (!Array.isArray(modes)) return null;
  if (modes.includes('news')) return 'news';
  return MEDIA_TYPES.find((type) => modes.includes(type)) || null;
}

export function alertDisplayPanelState(mode) {
  return {
    news: mode === 'news',
    media: MEDIA_TYPES.includes(mode),
    mediaType: MEDIA_TYPES.includes(mode) ? mode : null,
  };
}
