import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { RefObject } from 'react';

export async function exportReportToPdf(
  elementRef: RefObject<HTMLDivElement | null>,
  filename = 'interview-report.pdf'
) {
  if (!elementRef?.current) throw new Error('Report content is not ready yet.');
  const el = elementRef.current;
  if (!el.isConnected || el.offsetWidth === 0 || el.scrollHeight === 0) {
    throw new Error('Report content is not visible for rendering.');
  }

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });
  if (!canvas.width || !canvas.height) throw new Error('Could not render report content.');

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
}
