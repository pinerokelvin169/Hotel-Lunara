const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'demo';

const fallbackPublicIds = [
  'sample',
  'docs/casual-group',
  'docs/colored_pencils',
];

export function cloudinaryImage(source: string | undefined, index = 0, width = 1200) {
  if (source?.startsWith('http')) {
    return source;
  }

  const publicId = source?.trim() || fallbackPublicIds[index % fallbackPublicIds.length];
  return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto,w_${width},c_fill,ar_16:10/${publicId}`;
}

