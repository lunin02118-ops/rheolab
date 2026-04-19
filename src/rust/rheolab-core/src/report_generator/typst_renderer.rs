use std::path::PathBuf;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::Library;
use typst::World;
use typst_utils::LazyHash;

use std::collections::HashMap;

const FONT_ROBOTO: &[u8] = include_bytes!("../../assets/Roboto-Regular.ttf");
const FONT_ROBOTO_BOLD: &[u8] = include_bytes!("../../assets/Roboto-Bold.ttf");

pub struct TypstWrapper {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    source: Source,
    now: Option<Datetime>,
    files: HashMap<String, Bytes>,
}

impl TypstWrapper {
    pub fn new(source_text: &str, files: HashMap<String, Vec<u8>>) -> Self {
        // Init Fonts.
        //
        // The `.expect()` calls below fire only if the embedded Roboto byte
        // slices (`FONT_ROBOTO` / `FONT_ROBOTO_BOLD`, included at compile time
        // via `include_bytes!`) are corrupted.  Any such corruption would be
        // caught by `cargo build`; the panics here exist purely as tripwires
        // against accidental binary edits of the bundled font files.
        let font_reg = Font::new(Bytes::from_static(FONT_ROBOTO), 0)
            .expect("bundled Roboto Regular font is statically included and must be a valid TTF");
        let font_bold = Font::new(Bytes::from_static(FONT_ROBOTO_BOLD), 0)
            .expect("bundled Roboto Bold font is statically included and must be a valid TTF");
        
        let fonts = vec![font_reg, font_bold];

        let book = FontBook::from_fonts(fonts.iter());
        
        // Init Library
        let library = Library::default();

        let source = Source::detached(source_text);
        
        // Fixed date for reproducibility
        let now = Datetime::from_ymd(2024, 1, 1);

        // Convert files to Bytes
        let files_map = files.into_iter()
            .map(|(k, v)| (k, Bytes::from(v)))
            .collect();

        Self {
            library: LazyHash::new(library),
            book: LazyHash::new(book),
            fonts,
            source,
            now,
            files: files_map,
        }
    }
}

impl World for TypstWrapper {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.source.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.source.id() {
            Ok(self.source.clone())
        } else {
            Err(FileError::NotFound(PathBuf::from("unknown")))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        // Simple mapping: check if file path matches any key in our map
        // Typst paths are usually relative. We assume flat structure for now.
        let path = id.vpath().as_rooted_path();
        let path_str = path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        if let Some(content) = self.files.get(&path_str) {
            Ok(content.clone())
        } else {
            // Try full path match as fallback
            let full_path = path.to_string_lossy().to_string();
             if let Some(content) = self.files.get(&full_path) {
                Ok(content.clone())
            } else {
                Err(FileError::NotFound(path.to_path_buf()))
            }
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        self.now
    }
}

pub fn compile_to_pdf(source_text: &str, files: HashMap<String, Vec<u8>>) -> Result<Vec<u8>, String> {
    let world = TypstWrapper::new(source_text, files);
    let warned = typst::compile(&world);

    // Match on the Result directly so the compiler enforces exhaustiveness —
    // this removes two `.unwrap()` call sites (one `err().unwrap()` and one
    // `output.unwrap()` after a separate `is_err()` check) in favour of a
    // single structural destructure.
    let document = match warned.output {
        Ok(doc) => doc,
        Err(errors) => {
            let source = world.source(world.main()).ok();

            let msg = errors.iter()
                .map(|e| {
                    let mut parts = vec![e.message.to_string()];

                    // Try to resolve source span to line number
                    if let Some(src) = &source {
                        if let Some(range) = src.range(e.span) {
                            let text = src.text();
                            let line_num = text[..range.start.min(text.len())].matches('\n').count() + 1;
                            let line_start = text[..range.start.min(text.len())].rfind('\n').map(|i| i + 1).unwrap_or(0);
                            let line_end = text[range.start.min(text.len())..].find('\n').map(|i| range.start + i).unwrap_or(text.len());
                            let line_content = &text[line_start..line_end.min(text.len())];
                            parts.push(format!("  at line {}: {}", line_num, line_content.trim()));

                            // Show 2 lines before and after for context
                            let context_start = if line_num > 3 {
                                text.match_indices('\n').nth(line_num.saturating_sub(4)).map(|(i, _)| i + 1).unwrap_or(0)
                            } else { 0 };
                            let context_end = text.match_indices('\n').nth(line_num + 1).map(|(i, _)| i).unwrap_or(text.len());
                            let context = &text[context_start..context_end.min(text.len())];
                            parts.push(format!("  context:\n{}", context));
                        }
                    }

                    for hint in &e.hints {
                        parts.push(format!("  hint: {}", hint));
                    }
                    parts.join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n---\n");
            return Err(format!("Typst error: {}", msg));
        }
    };

    match typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()) {
        Ok(bytes) => Ok(bytes),
        Err(e) => Err(format!("PDF export error: {:?}", e)),
    }
}
