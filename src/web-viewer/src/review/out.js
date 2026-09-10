export function reviewFile(bytes, name) {
  const stem = name.replace(/\.mdpkg$/i, '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 100) || 'package';
  return new File([bytes], stem + '-review.mdpkg', {type: 'application/octet-stream'});
}

export function downloadReview(file) {
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name; link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    // Allow the browser to consume the URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
