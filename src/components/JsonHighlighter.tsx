import React from 'react';

interface JsonHighlighterProps {
  json: string;
  className?: string;
}

/**
 * Simple JSON syntax highlighter component
 * Highlights keys, strings, numbers, booleans, and null values
 */
export const JsonHighlighter: React.FC<JsonHighlighterProps> = ({ json, className = '' }) => {
  const highlightJson = (text: string) => {
    // Pattern to match JSON tokens
    const parts: Array<{ type: string; value: string }> = [];
    let remaining = text;
    
    while (remaining.length > 0) {
      // String (including keys)
      let match = remaining.match(/^"(?:[^"\\]|\\.)*"/);
      if (match) {
        parts.push({ type: 'string', value: match[0] });
        remaining = remaining.slice(match[0].length);
        continue;
      }
      
      // Number
      match = remaining.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        parts.push({ type: 'number', value: match[0] });
        remaining = remaining.slice(match[0].length);
        continue;
      }
      
      // Boolean and null
      match = remaining.match(/^(?:true|false|null)\b/);
      if (match) {
        parts.push({ type: 'literal', value: match[0] });
        remaining = remaining.slice(match[0].length);
        continue;
      }
      
      // Structural characters and whitespace
      if (/^[\{\}\[\],:]/m.test(remaining)) {
        parts.push({ type: 'punctuation', value: remaining[0] });
        remaining = remaining.slice(1);
        continue;
      }
      
      // Whitespace
      match = remaining.match(/^\s+/);
      if (match) {
        parts.push({ type: 'whitespace', value: match[0] });
        remaining = remaining.slice(match[0].length);
        continue;
      }
      
      // Fallback: consume one character
      parts.push({ type: 'unknown', value: remaining[0] });
      remaining = remaining.slice(1);
    }
    
    return parts.map((part, idx) => {
      switch (part.type) {
        case 'string': {
          // Check if this is a key (followed by :)
          const isKeyPattern = /^"[^"]*"(?:\s*):/;
          const isKey = isKeyPattern.test(text.slice(text.indexOf(part.value)));
          return (
            <span key={idx} className={isKey ? 'json-key' : 'json-string'}>
              {part.value}
            </span>
          );
        }
        case 'number':
          return <span key={idx} className="json-number">{part.value}</span>;
        case 'literal':
          return <span key={idx} className="json-literal">{part.value}</span>;
        case 'punctuation':
          return <span key={idx} className="json-punctuation">{part.value}</span>;
        case 'whitespace':
          return <span key={idx}>{part.value}</span>;
        default:
          return <span key={idx}>{part.value}</span>;
      }
    });
  };

  return (
    <code className={`json-highlighter ${className}`}>
      {highlightJson(json)}
    </code>
  );
};
