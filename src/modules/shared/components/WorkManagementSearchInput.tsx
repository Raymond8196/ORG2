import { type RefObject, memo, useCallback } from "react";

import { SearchInput } from "@src/components/SearchInput";

interface WorkManagementSearchInputProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onClose?: () => void;
  dataTestId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Compact controlled search shared by Work Management page headers. */
export const WorkManagementSearchInput = memo(
  ({
    value,
    placeholder,
    onChange,
    onClose,
    dataTestId,
    inputRef,
  }: WorkManagementSearchInputProps) => {
    const clear = useCallback(() => onChange(""), [onChange]);

    return (
      <div data-testid={dataTestId}>
        <SearchInput
          value={value}
          onChange={onChange}
          onClear={clear}
          onClose={onClose}
          showClearButton
          hideChevron
          variant="panel"
          surface="pane"
          className="w-64 max-w-[28vw]"
          placeholder={placeholder}
          ariaLabel={placeholder}
          inputRef={inputRef}
        />
      </div>
    );
  }
);

WorkManagementSearchInput.displayName = "WorkManagementSearchInput";
