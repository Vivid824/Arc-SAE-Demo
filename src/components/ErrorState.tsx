type ErrorStateProps = {
  title: string
  message: string
  details?: string
}

export function ErrorState({ title, message, details }: ErrorStateProps) {
  return (
    <div className="error-state panel" role="alert" aria-live="polite">
      <h1 className="view-title">{title}</h1>
      <p className="section-copy">{message}</p>
      {details ? (
        <details className="error-details">
          <summary>Technical details</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
    </div>
  )
}
