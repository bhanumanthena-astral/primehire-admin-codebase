import React, {useState} from 'react';
import {render, screen, fireEvent, cleanup} from '@testing-library/react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {ResumeFilePicker} from '../ResumeFilePicker';

afterEach(cleanup);
function Example() {
  const [files, setFiles] = useState<File[]>([]);
  return <ResumeFilePicker files={files} onChange={setFiles}/>;
}
const resume = (name: string) => new File(['Example resume'], name, {lastModified: 1});
function choose(files: File[]) {
  fireEvent.change(screen.getByLabelText('Resume files'), {target: {files}});
}
describe('resume file selection', () => {
  it('appends browse and dropped files, avoids duplicates, and supports removal and clearing', () => {
    render(<Example/>);
    const first = resume('first.pdf');
    choose([first]);
    fireEvent.drop(screen.getByRole('group'), {dataTransfer: {files: [first, resume('second.docx')]}});
    expect(screen.getByRole('button', {name: 'Remove first.pdf'})).toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: /^Remove /})).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', {name: 'Remove first.pdf'}));
    expect(screen.queryByText('first.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('second.docx')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Clear all'}));
    expect(screen.queryByLabelText('Selected resumes')).not.toBeInTheDocument();
  });

  it('accepts valid files in a mixed selection and reports wrong formats, empty and oversized files', () => {
    render(<Example/>);
    const large = resume('large.pdf');
    Object.defineProperty(large, 'size', {value: 5 * 1024 * 1024 + 1});
    choose([resume('valid.DOC'), resume('photo.png'), new File([], 'empty.pdf'), large]);
    expect(screen.getByRole('button', {name: 'Remove valid.DOC'})).toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: /^Remove /})).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('choose a PDF, DOCX or DOC');
    expect(screen.getByRole('alert')).toHaveTextContent('this file is empty');
    expect(screen.getByRole('alert')).toHaveTextContent('exceeds the 5 MB');
  });

  it('limits the combined batch to ten files, including subsequent selections', () => {
    render(<Example/>);
    choose(Array.from({length: 9}, (_, i) => resume(`resume-${i}.pdf`)));
    choose([resume('tenth.docx'), resume('eleventh.pdf')]);
    expect(screen.getAllByRole('button', {name: /^Remove /})).toHaveLength(10);
    expect(screen.getByRole('alert')).toHaveTextContent('up to 10 resumes');
    expect(screen.queryByRole('button', {name: 'Remove eleventh.pdf'})).not.toBeInTheDocument();
  });

  it.each([{disabled: true}, {uploading: true}])('prevents selection and file changes when locked (%j)', props => {
    const change = vi.fn();
    render(<ResumeFilePicker files={[resume('first.pdf')]} onChange={change} {...props}/>);
    expect(screen.getByLabelText('Resume files')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Remove first.pdf'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Clear all'})).toBeDisabled();
    fireEvent.drop(screen.getByRole('group'), {dataTransfer: {files: [resume('second.docx')]}});
    expect(change).not.toHaveBeenCalled();
  });
});
