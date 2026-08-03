// Prerender the shell for static hosting; client routes use adapter-static fallback.
export const prerender = true;

// GitHub Pages serves directories, not extensionless paths like /about.html.
export const trailingSlash = 'always';
