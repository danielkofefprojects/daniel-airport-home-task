import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, Renderer } from 'marked';

const renderer = new Renderer();
renderer.table = function (this: Renderer, { header, rows }) {
  const cellHtml = (cell: { tokens: import('marked').Token[] }) => this.parser.parseInline(cell.tokens);
  const headHtml = `<thead><tr>${header.map((cell) => `<th>${cellHtml(cell)}</th>`).join('')}</tr></thead>`;
  const bodyHtml = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cellHtml(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<div class="table-scroll"><table>${headHtml}${bodyHtml}</table></div>`;
};

marked.setOptions({ breaks: true, renderer });

@Pipe({
  name: 'markdown',
  standalone: true
})
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(text: string | undefined | null): SafeHtml {
    const html = marked.parse(text ?? '', { async: false });
    return this.sanitizer.sanitize(1 /* SecurityContext.HTML */, html) ?? '';
  }
}
