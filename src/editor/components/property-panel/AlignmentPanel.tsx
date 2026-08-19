import { Button } from '../../../components/ui/button';
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';

export type AlignmentType = 
  | 'left' 
  | 'center-h' 
  | 'right' 
  | 'top' 
  | 'center-v' 
  | 'bottom' 
  | 'distribute-h' 
  | 'distribute-v';

interface AlignmentPanelProps {
  onAlign: (type: AlignmentType) => void;
  canDistribute: boolean;
}

export function AlignmentPanel({ onAlign, canDistribute }: AlignmentPanelProps) {
  return (
    <div className="flex items-center gap-0.5 mb-2">
      <TooltipButton
        icon={<AlignHorizontalJustifyStart className="h-3.5 w-3.5" />}
        label="左揃え"
        onClick={() => onAlign('left')}
      />
      <TooltipButton
        icon={<AlignHorizontalJustifyCenter className="h-3.5 w-3.5" />}
        label="水平方向中央揃え"
        onClick={() => onAlign('center-h')}
      />
      <TooltipButton
        icon={<AlignHorizontalJustifyEnd className="h-3.5 w-3.5" />}
        label="右揃え"
        onClick={() => onAlign('right')}
      />
      
      <div className="w-px h-3 bg-[#4a4a4a] mx-0.5" />
      
      <TooltipButton
        icon={<AlignVerticalJustifyStart className="h-3.5 w-3.5" />}
        label="上揃え"
        onClick={() => onAlign('top')}
      />
      <TooltipButton
        icon={<AlignVerticalJustifyCenter className="h-3.5 w-3.5" />}
        label="垂直方向中央揃え"
        onClick={() => onAlign('center-v')}
      />
      <TooltipButton
        icon={<AlignVerticalJustifyEnd className="h-3.5 w-3.5" />}
        label="下揃え"
        onClick={() => onAlign('bottom')}
      />

      <div className="w-px h-3 bg-[#4a4a4a] mx-0.5" />

      <TooltipButton
        icon={<AlignHorizontalSpaceAround className="h-3.5 w-3.5" />}
        label="水平方向等間隔"
        onClick={() => onAlign('distribute-h')}
        disabled={!canDistribute}
      />
      <TooltipButton
        icon={<AlignVerticalSpaceAround className="h-3.5 w-3.5" />}
        label="垂直方向等間隔"
        onClick={() => onAlign('distribute-v')}
        disabled={!canDistribute}
      />
    </div>
  );
}

function TooltipButton({ icon, label, onClick, disabled }: { icon: React.ReactNode, label: string, onClick: () => void, disabled?: boolean }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-sm text-gray-400 hover:text-white hover:bg-[#4a4a4a] disabled:opacity-30"
            onClick={onClick}
            disabled={disabled}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
