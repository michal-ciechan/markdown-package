const stem = name => name.replace(/\.mdpkg$/i, '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 100) || 'package';

export function reviewFile(bytes, name) {
  return new File([bytes], stem(name) + '-review.mdpkg', {type: 'application/octet-stream'});
}

// The plain-Markdown export shares downloadReview, which takes any File. It is
// a separate artifact from the .mdpkg delta and never stands in for it.
export function markdownFile(text, name) {
  return new File([text], stem(name) + '-review.md', {type: 'text/markdown'});
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
