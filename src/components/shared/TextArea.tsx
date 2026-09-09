import { useImperativeHandle, useLayoutEffect, useRef, type ComponentPropsWithRef } from 'react';

type TextAreaProps = Omit<ComponentPropsWithRef<'textarea'>, 'value' | 'defaultValue'> & { value: string };

export function TextArea({ value, ref, ...props }: TextAreaProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const initialValue = useRef(value);
  useImperativeHandle(ref, () => input.current!, []);
  useLayoutEffect(() => {
    // Native edits already hold the new value. Only external changes need a DOM
    // write; rewriting defaultValue on each key relayouts very long manuscripts.
    if (input.current && input.current.value !== value) input.current.value = value;
  }, [value]);
  return <textarea {...props} ref={input} defaultValue={initialValue.current} />;
}
