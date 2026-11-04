import {useState} from 'react';
// Editors stay mounted while another section is shown, preserving local input.
export default function KeepProjectPanel({active,children}){const [opened,setOpened]=useState(active);if(active && !opened)setOpened(true);return opened?<section hidden={!active}>{children}</section>:null;}
