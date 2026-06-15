use crate::error::AppError;

pub(crate) fn map_pdf_error(
    log_context: &'static str,
    user_message: &'static str,
    error: String,
) -> AppError {
    tracing::error!("{}: {}", log_context, error);
    AppError::Other(user_message.into())
}

pub(crate) fn map_pdf_error_with_detail(
    log_context: &'static str,
    user_context: &'static str,
    error: String,
) -> AppError {
    tracing::error!("{}: {}", log_context, error);
    AppError::Other(format!("{}: {}", user_context, error))
}
