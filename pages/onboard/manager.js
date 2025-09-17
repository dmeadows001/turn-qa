// ...keep the rest of your file the same...

{step === 'done' && (
  <>
    <p>All set! You’ll receive TurnQA job alerts to {phone}.</p>
    {propertyId && (
      <p style={{ marginTop: 8 }}>
        Property link status: {linkResult === 'linked' ? 'Linked to property.' : (linkResult || 'Linking…')}
      </p>
    )}

    <div style={{ marginTop: 16 }}>
      {propertyId && (
        <a style={{ display:'inline-block', marginRight:8, padding:'10px 14px', borderRadius:10, border:'1px solid #94a3b8', background:'#f8fafc', textDecoration:'none' }}
           href={`/properties/${propertyId}/template`}>
          Create template
        </a>
      )}
      <a style={{ display:'inline-block', padding:'10px 14px', borderRadius:10, border:'1px solid #94a3b8', background:'#f8fafc', textDecoration:'none' }}
         href="/dashboard">
        Go to Dashboard
      </a>
    </div>
  </>
)}
