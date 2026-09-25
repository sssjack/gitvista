import { memo } from 'react';
import type { SyntaxToken } from '../lib/syntax';
import './syntax.css';

export default memo(function SyntaxTokens({ tokens }: { tokens: SyntaxToken[] }) {
  return <>{tokens.map((token, index) => token.kind === 'plain' ? token.text : <span className={`syntax-token syntax-${token.kind}`} key={index}>{token.text}</span>)}</>;
});
