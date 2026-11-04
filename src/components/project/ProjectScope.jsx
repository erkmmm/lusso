import {ProjectWorkspaceContext,useProjectWorkspace} from '../../contexts/ProjectWorkspaceContext';
export default function ProjectScope({params,search,children}){const parent=useProjectWorkspace();return <ProjectWorkspaceContext.Provider value={{...parent,params:{...parent.params,...params},...(search!==undefined?{search}:{})}}>{children}</ProjectWorkspaceContext.Provider>;}
