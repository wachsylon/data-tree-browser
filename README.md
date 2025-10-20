# data-tree-browser

In-browser Xarray DataTree viewer

## Usage

Open https://wachsylon.github.io/data-tree-browser/

- Enter a Zarr store base URI.
- Requirement: the store must provide consolidated `/.zmetadata` and allow CORS from browsers.

## Notes

- The app is static (no build needed) and served as-is: `index.html`, `styles.css`, `app.js`.
- Keyboard navigation: Up (parent), Down (first child), Left/Right (siblings).
